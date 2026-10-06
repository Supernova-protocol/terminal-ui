"""Admin page run against `npm run dev:mock`: checklist, wallet, create platform, claim platform fees, edit platform.
Usage: python3 tests/e2e/admin.py [base_url] [out_prefix]"""
import asyncio, sys, os, re
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sn-admin'
ROOT = os.path.dirname(os.path.abspath(__file__))
NACL = open(os.path.join(ROOT, '../../node_modules/tweetnacl/nacl-fast.min.js')).read()
WALLET = open(os.path.join(ROOT, 'test-wallet.js')).read()

async def wait_js(page, expr, timeout=30000, poll=0.15):
    """Poll a JS expression with page.evaluate (works under a strict CSP, unlike wait_for_function with strings)."""
    loop = asyncio.get_event_loop()
    end = loop.time() + timeout / 1000
    last = None
    while loop.time() < end:
        try:
            if await page.evaluate(expr):
                return True
        except Exception as e:
            last = e
        await asyncio.sleep(poll)
    raise TimeoutError(f'wait_js timed out after {timeout}ms: {expr[:90]}' + (f' (last error: {last})' if last else ''))

async def main():
    results, logs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        await ctx.add_init_script(NACL + '\n' + WALLET)
        pg = await ctx.new_page()
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text[:400]}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        await pg.route('https://*.raydium.io/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"success":true,"data":[]}'))

        def ok(name, cond, extra=''):
            results.append(('PASS' if cond else 'FAIL', name, extra))

        async def step(name, fn):
            try:
                await fn()
            except Exception as e:
                results.append(('FAIL', name, str(e).split(chr(10))[0][:200]))
                try: await pg.screenshot(path=f'{OUT}_fail_{re.sub(r"[^a-z]+", "_", name)}.png')
                except Exception: pass

        async def checklist():
            await pg.goto(BASE + '/admin.html')
            await pg.wait_for_selector('#setup-list li.ok', timeout=20000)
            n = await pg.locator('#setup-list li').count()
            ok('setup checklist', n >= 12, f"{n} items · {await pg.locator('#setup-score').inner_text()}")
            ok('default platform warning', 'No platform of your own yet' in await pg.locator('#plat-body').inner_text())
        await step('checklist', checklist)

        async def connect():
            await pg.click('#adm-wallet-btn')
            await pg.wait_for_selector('#aw-body [data-wallet]', timeout=10000)
            await pg.click('#aw-body [data-wallet]')
            await pg.wait_for_selector('#create-form', timeout=30000)
            ok('wallet connected', True, await pg.locator('#adm-wallet-btn').inner_text())
            await pg.screenshot(path=OUT + '_1_create_form.png', full_page=True)
        await step('connect', connect)

        async def fees_claim():
            await pg.wait_for_selector('#fees-body [data-claim]:not([disabled])', timeout=20000)
            before = await pg.locator('#fees-body').inner_text()
            ok('default platform fees claimable', 'Claim' in before, before.replace(chr(10), ' ')[:140])
            await pg.click('#fees-body [data-claim]:not([disabled])')
            await wait_js(pg, "document.querySelector('#adm-toast') && !document.querySelector('#adm-toast').hidden && document.querySelector('#adm-toast').textContent.includes('Fees claimed')", timeout=30000)
            await pg.wait_for_timeout(800)
            after = await pg.locator('#fees-body').inner_text()
            ok('fees claimed', 'Unclaimed\n0 SOL' in after or 'Unclaimed 0 SOL' in after.replace(chr(10), ' '), after.replace(chr(10), ' ')[:120])
        await step('fees claim', fees_claim)

        async def create():
            await pg.fill('#pf-img', 'https://supernova.example/logo.png')
            await pg.fill('#pf-sp', '20'); await pg.fill('#pf-sb', '70')
            ok('scale sum shown', '100%' in await pg.locator('#pf-scale-sum').inner_text())
            await pg.click('#pf-submit')
            await wait_js(pg, "document.querySelector('#plat-body') && document.querySelector('#plat-body').textContent.includes('Created')", timeout=40000)
            body = await pg.locator('#plat-body').inner_text()
            ok('platform created', 'PLATFORM_ID=' in body and '0.5%' in body, body.replace(chr(10), ' ')[:220])
            ok('lp split stored', '20% / 10% / 70%' in body, 'LP split')
            ok('no stale warning', 'No platform of your own yet' not in body)
            await pg.screenshot(path=OUT + '_2_created.png', full_page=True)
        await step('create platform', create)

        async def edit():
            await pg.click('[data-edit]')
            await pg.wait_for_selector('#edit-form')
            await pg.fill('#pe-fee', '0.6')
            await pg.fill('#pe-name', 'Supernova Launchpad')
            await pg.click('#pe-submit')
            await wait_js(pg, "document.querySelector('#adm-toast') && document.querySelector('#adm-toast').textContent.includes('Platform updated')", timeout=40000)
            await pg.wait_for_timeout(600)
            body = await pg.locator('#plat-body').inner_text()
            ok('platform edited', '0.6%' in body and 'Supernova Launchpad' in body, body.replace(chr(10), ' ')[:160])
            await pg.screenshot(path=OUT + '_3_edited.png', full_page=True)
        await step('edit platform', edit)

        async def own_fees():
            txt = await pg.locator('#fees-body').inner_text()
            ok('own platform listed in fees', 'Your platform' in txt, txt.replace(chr(10), ' ')[:200])
        await step('own fees', own_fees)

        async def mobile():
            m = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            mp = await m.new_page()
            await mp.route('https://fonts.googleapis.com/**', lambda r: r.abort())
            await mp.goto(BASE + '/admin.html')
            await mp.wait_for_selector('#setup-list li.ok', timeout=20000)
            sw = await mp.evaluate('document.documentElement.scrollWidth')
            ok('admin mobile no overflow', sw <= 390, f'scrollWidth {sw}')
            await mp.screenshot(path=OUT + '_4_mobile.png', full_page=True)
            await m.close()
        await step('mobile', mobile)

        await b.close()
    for r in results: print(' | '.join(r))
    print('--- console errors/warnings:', len(logs))
    for l in logs[:30]: print(l)

asyncio.run(main())
