"""Revenue flow against a mock server started with PLATFORM_ID = the test wallet's platform:
admin creates the platform -> a coin is launched on it -> platform fees accrue -> admin claims them.
Usage: PLATFORM_ID=<pda> MOCK=1 vite --port 5181, then python3 tests/e2e/revenue.py http://localhost:5181"""
import asyncio, sys, os
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5181'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sn-revenue'
ROOT = os.path.dirname(os.path.abspath(__file__))
NACL = open(os.path.join(ROOT, '../../node_modules/tweetnacl/nacl-fast.min.js')).read()
WALLET = open(os.path.join(ROOT, 'test-wallet.js')).read()

async def wait_js(page, expr, timeout=30000):
    loop = asyncio.get_event_loop(); end = loop.time() + timeout / 1000
    while loop.time() < end:
        try:
            if await page.evaluate(expr): return True
        except Exception: pass
        await asyncio.sleep(0.15)
    raise TimeoutError('timed out: ' + expr[:90])

async def main():
    results = []
    ok = lambda n, c, x='': results.append(('PASS' if c else 'FAIL', n, x))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        await ctx.add_init_script(NACL + '\n' + WALLET)
        pg = await ctx.new_page()
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('https://*.raydium.io/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"success":true,"data":[]}'))
        try:
            # 1. create the platform the server is configured to use
            await pg.goto(BASE + '/admin.html')
            await pg.click('#adm-wallet-btn'); await pg.click('#aw-body [data-wallet]')
            await pg.wait_for_selector('#create-form', timeout=30000)
            await pg.fill('#pf-fee', '1')
            await pg.click('#pf-submit')
            await wait_js(pg, "document.querySelector('#plat-body').textContent.includes('Active on this site')", 40000)
            ok('platform created and active', True)
            # 2. launch a coin with a 2 SOL dev buy on the main site
            await pg.goto(BASE + '/?view=launch')
            await pg.wait_for_selector('#forge-in', timeout=30000)
            await pg.wait_for_timeout(1500)
            if await pg.locator('#wallet-btn .wb-addr').count() == 0:
                await pg.click('#wallet-btn'); await pg.click('#wm-body [data-wallet]')
                await wait_js(pg, "document.querySelector('#wallet-btn .wb-addr') !== null", 15000)
            await pg.fill('#forge-in', 'a frog that only buys the dip')
            await pg.click('#forge-go')
            await wait_js(pg, "document.querySelector('#f-name').value.length > 2 && !document.querySelector('#forge-go').disabled", 60000)
            dev = pg.locator('#f-dev')
            if await dev.count(): await dev.fill('2')
            await pg.click('#deploy-btn')
            await pg.wait_for_selector('.success-burst h3', timeout=120000)
            ok('coin launched on the custom platform', 'live' in await pg.locator('.success-burst h3').inner_text())
            # 3. the platform vault received 1% of the dev buy; claim it from the admin page
            await pg.goto(BASE + '/admin.html')
            await wait_js(pg, "document.querySelector('#adm-wallet-btn').textContent.includes('…')", 15000)  # silent reconnect of the trusted wallet
            ok('wallet restored after reload', True)
            await pg.wait_for_selector('#fees-body [data-claim]', timeout=30000)
            await wait_js(pg, "!!document.querySelector('#fees-body [data-claim]:not([disabled])')", 30000)
            txt = await pg.locator('#fees-body').inner_text()
            ok('platform fees accrued', 'Active platform' in txt and 'Claim 0.0' in txt, txt.replace('\n', ' ')[:140])
            await pg.click('#fees-body [data-claim]:not([disabled])')
            await wait_js(pg, "document.querySelector('#adm-toast').textContent.includes('Fees claimed')", 30000)
            ok('platform fees claimed', True)
            await pg.screenshot(path=OUT + '_fees.png', full_page=True)
        except Exception as e:
            results.append(('FAIL', 'revenue flow', str(e).split('\n')[0][:200]))
            await pg.screenshot(path=OUT + '_fail.png', full_page=True)
        await b.close()
    for r in results: print(' | '.join(r))

asyncio.run(main())
