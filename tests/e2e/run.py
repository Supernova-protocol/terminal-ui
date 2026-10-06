"""End-to-end UI run against `npm run dev:mock` (simulated devnet). Usage: python3 tests/e2e/run.py [base_url] [out_prefix]
Start a fresh mock server for each run: the simulator keeps its state (balances, Pro, quotas) while it runs."""
import asyncio, sys, os
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/sn-e2e'
ROOT = os.path.dirname(os.path.abspath(__file__))
NACL = open(os.path.join(ROOT, '../../node_modules/tweetnacl/nacl-fast.min.js')).read()
WALLET = open(os.path.join(ROOT, 'test-wallet.js')).read()
FIXTURE = os.path.join(ROOT, 'fixture.jpg')
JPG = open(FIXTURE, 'rb').read() if os.path.exists(FIXTURE) else b''

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
        ctx = await b.new_context(viewport={'width': 1440, 'height': 980})
        await ctx.add_init_script(NACL + '\n' + WALLET)
        pg = await ctx.new_page()
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text[:400]}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))

        async def img(route):
            await route.fulfill(status=200, content_type='image/jpeg', body=JPG)
        await pg.route('https://images.pexels.com/**', img)
        await pg.route('https://gateway.pinata.cloud/**', img)
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await pg.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        await pg.route('https://dd.dexscreener.com/**', lambda r: r.abort())
        await pg.route('https://*.raydium.io/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"success":true,"data":[]}'))

        def ok(name, cond, extra=''):
            results.append(('PASS' if cond else 'FAIL', name, extra))

        # 1. hub
        try:
            await pg.goto(BASE + '/?view=hub')
            await pg.wait_for_selector('#scan-body tr', timeout=30000)
            await pg.wait_for_timeout(2500)
            rows = await pg.locator('#scan-body tr').count()
            ok('hub scanner rows', rows >= 10, f'{rows} rows')
            ok('hub launch stat', (await pg.locator('#hs-launch').inner_text()).strip() not in ('', '0'), await pg.locator('#hs-launch').inner_text())
            feed = await pg.locator('#feed-list .feed-item').count()
            ok('hub live feed', feed > 0, f'{feed} items')
            await pg.screenshot(path=OUT + '_1_hub.png')

        except Exception as e:
            results.append(('FAIL', 'step 1 hub', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_1.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 2. connect wallet
        try:
            await pg.click('#wallet-btn')
            await pg.wait_for_selector('#wm-body [data-wallet]', timeout=10000)
            await pg.screenshot(path=OUT + '_2_wallet_modal.png')
            await pg.click('#wm-body [data-wallet]')
            await wait_js(pg, "document.querySelector('#wallet-btn .wb-addr') !== null", timeout=15000)
            await wait_js(pg, "(document.querySelector('#wb-bal')||{}).textContent && document.querySelector('#wb-bal').textContent.includes('SOL')", timeout=20000)
            ok('wallet connected', True, await pg.locator('#wallet-btn').inner_text())

        except Exception as e:
            results.append(('FAIL', 'step 2 connect wallet', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_2.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 3. terminal on a Supernova coin
        try:
            await pg.click('#scan-filters [data-filter="launches"]')
            await pg.wait_for_timeout(600)
            await pg.locator('#scan-body tr').first.click()
            await pg.wait_for_selector('#term-head .th-name', timeout=15000)
            await pg.wait_for_timeout(4000)
            ok('terminal chart source', (await pg.locator('#chart-src').inner_text()) != '', await pg.locator('#chart-src').inner_text())
            ok('depth ladder', 'Impact' in await pg.locator('#ob').inner_text() and '%' in await pg.locator('#ob').inner_text())
            tape = await pg.locator('#tape .tape-row').count()
            ok('trade tape', tape > 0, f'{tape} rows')
            await wait_js(pg, "document.querySelector('#intel-body .intel-item') !== null", timeout=30000)
            ok('token intel', True, (await pg.locator('#intel-body').inner_text())[:120].replace('\n', ' | '))
            await pg.screenshot(path=OUT + '_3_terminal.png')

        except Exception as e:
            results.append(('FAIL', 'step 3 terminal on a Supernova coin', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_3.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 4. buy on the curve
        try:
            await pg.click('#side-seg [data-side="buy"]')
            await pg.fill('#amt-input', '0.25')
            await wait_js(pg, "document.querySelector('#quote .big b') && !document.querySelector('#quote .big b').textContent.includes('—') && !document.querySelector('#quote .big .spin-sm')", timeout=60000)
            ok('curve quote', True, await pg.locator('#quote .big b').inner_text())
            await pg.click('#exec-btn')
            await pg.wait_for_selector('.toast:has-text("Bought")', timeout=90000)
            ok('buy executed', True, (await pg.locator('.toast:has-text("Bought")').first.inner_text())[:140].replace('\n', ' '))
            await pg.wait_for_timeout(7000)
            await pg.screenshot(path=OUT + '_4_after_buy.png')
            pos = await pg.locator('#pos-body').inner_text()
            ok('position shows holding', 'Holding' in pos, pos[:100].replace('\n', ' '))

        except Exception as e:
            results.append(('FAIL', 'step 4 buy on the curve', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_4.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 5. sell half
        try:
            await pg.click('#side-seg [data-side="sell"]')
            await pg.click('#quick [data-q="50%"]')
            await wait_js(pg, "document.querySelector('#quote .big b') && document.querySelector('#quote .big b').textContent.includes('SOL')", timeout=60000)
            await pg.click('#exec-btn')
            await pg.wait_for_selector('.toast:has-text("Sold")', timeout=90000)
            ok('sell executed', True)

        except Exception as e:
            results.append(('FAIL', 'step 5 sell half', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_5.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 6. AI analyst (SIWS + preset)
        try:
            await pg.click('#ai-presets [data-preset="rug"]')
            await wait_js(pg, "document.querySelector('#ai-status') && document.querySelector('#ai-status').textContent === 'Complete'", timeout=90000)
            ok('ai analysis', True, (await pg.locator('#ai-text').inner_text())[:120])
            await pg.screenshot(path=OUT + '_5_ai.png')
            # second analysis hits the free limit → Pro modal
            await pg.click('#ai-presets [data-preset="whales"]')
            await pg.wait_for_selector('#pro-modal.open', timeout=30000)
            ok('free quota → pro modal', True)
            await pg.screenshot(path=OUT + '_6_pro_modal.png')
            await pg.click('[data-pay-sol]')
            await pg.wait_for_selector('.toast:has-text("Welcome to Supernova Pro")', timeout=90000)
            ok('pro paid with SOL', True)
            await pg.keyboard.press('Escape')
            await pg.click('#ai-presets [data-preset="entry"]')
            await wait_js(pg, "document.querySelector('#ai-status').textContent === 'Complete'", timeout=90000)
            ok('pro analysis + levels', await pg.locator('#ai-levels').is_visible())
            await pg.screenshot(path=OUT + '_7_ai_pro.png')

        except Exception as e:
            results.append(('FAIL', 'step 6 AI analyst (SIWS + preset)', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_6.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 7. launch a coin with the AI creator
        try:
            await pg.click('.nav-btn[data-nav="launch"]')
            await pg.wait_for_timeout(800)
            await pg.fill('#forge-in', 'a raccoon that robs bear markets')
            await pg.click('#forge-go')
            await wait_js(pg, "document.querySelector('#f-name').value.length > 2 && !document.querySelector('#forge-go').disabled", timeout=60000)
            await pg.wait_for_timeout(1200)
            ok('ai creator filled form', True, await pg.locator('#f-name').input_value() + ' $' + await pg.locator('#f-ticker').input_value())
            await pg.screenshot(path=OUT + '_8_launch_form.png')
            await pg.click('#deploy-btn')
            await pg.wait_for_selector('.success-burst h3', timeout=120000)
            title = await pg.locator('.success-burst h3').inner_text()
            ok('coin launched', 'live' in title, title)
            await pg.screenshot(path=OUT + '_9_launched.png')

        except Exception as e:
            results.append(('FAIL', 'step 7 launch a coin with the AI creator', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_7.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 8. profile
        try:
            await pg.click('.nav-btn[data-nav="profile"]')
            await pg.wait_for_timeout(3500)
            await pg.screenshot(path=OUT + '_10_profile.png', full_page=True)
            prof = await pg.locator('#launched').inner_text()
            ok('profile lists launched coin', len(prof.strip()) > 0 and 'yet' not in prof, prof[:80].replace('\n', ' '))
            # creator rewards: trades on the test wallet's coins accrue creator fees in the LaunchLab creator vault
            await wait_js(pg, "(document.querySelector('#creator-fees')||{}).textContent && document.querySelector('#creator-fees').textContent.includes('claimable')", timeout=20000)
            fees = await pg.locator('#creator-fees').inner_text()
            ok('creator rewards shown', 'SOL claimable' in fees and not fees.startswith('0 '), fees)
            await pg.click('[data-claim]:not([disabled])')
            await wait_js(pg, "[...document.querySelectorAll('#toasts .toast')].some(t => t.textContent.includes('Claimed'))", timeout=30000)
            ok('creator rewards claimed', True)

        except Exception as e:
            results.append(('FAIL', 'step 8 profile', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_8.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

        # 9. mobile layout
        try:
            m = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
            mp = await m.new_page()
            await mp.route('https://fonts.googleapis.com/**', lambda r: r.abort())
            await mp.goto(BASE + '/?view=hub')
            await mp.wait_for_timeout(5000)
            await mp.click('#wallet-btn')
            await mp.wait_for_timeout(800)
            await mp.screenshot(path=OUT + '_11_mobile_wallets.png')
            txt = await mp.locator('#wm-body').inner_text()
            ok('mobile deep links', 'Open Supernova in' in txt, txt[:100].replace('\n', ' '))
            await b.close()

        except Exception as e:
            results.append(('FAIL', 'step 9 mobile layout', str(e).split(chr(10))[0][:160]))
            try:
                await pg.screenshot(path=OUT + '_fail_9.png')
                results.append(('INFO', 'ai-status', await pg.locator('#ai-status').inner_text() + ' / ' + (await pg.locator('#ai-text').inner_text())[:160]))
            except Exception:
                pass

    for r in results: print(*r, sep=' | ')
    errs = [l for l in logs if 'favicon' not in l]
    print('--- console errors/warnings:', len(errs))
    for l in errs[:40]: print(l)

asyncio.run(main())
