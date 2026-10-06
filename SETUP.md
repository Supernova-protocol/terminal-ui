# Supernova: setup and go-live guide

This guide takes you from the code in this folder to a live site where people connect Phantom, Solflare, Trust Wallet or Backpack, launch real coins, trade them, use the AI analyst and pay for Pro with Apple Pay, card or SOL.

**Start on devnet.** Devnet is Solana's test network: SOL there is free and worthless, so you can try every flow (launching, trading, paying) without risking money. Only switch to mainnet when everything in the devnet checklist works.

---

## 1. How it works (one minute)

| Part | What it does | Where |
|---|---|---|
| Website | The whole UI (discover, terminal, launch, profile, Pro) | `index.html`, `src/` |
| Admin page | Setup checklist, create your LaunchLab platform, claim platform fees | `/admin.html`, `src/admin.ts` |
| API | One Vercel function that serves every `/api/*` route | `api/router.ts`, `server/` |
| Database | Launch index, trades, sessions, Pro status | Upstash Redis |
| Chain | Coins are created and traded on **Raydium LaunchLab** bonding curves; graduated coins trade on Raydium (and through Jupiter on mainnet) | Solana |

Supernova is **non-custodial**: every transaction is built in the browser and signed by the user's own wallet. The server never sees a private key or a seed phrase, and it never holds user funds.

**How you earn money**

1. **Platform fee** on every bonding-curve trade of coins launched through Supernova (you set it, for example 0.5%). It builds up in a LaunchLab vault and you claim it as SOL on the admin page.
2. **Pro subscriptions**: card, Apple Pay and Google Pay through Stripe (monthly), or SOL paid straight to your treasury wallet.
3. Optional: a Jupiter referral fee on swaps of graduated coins (mainnet).

Your wallet `AwKiYEP8scU4UWF6n7DTjZMMmzXJYtc7HtSr1gB7qGrM` is already filled in as treasury and admin wallet in `.env.example`. Use the same wallet to create the platform (step 5), so platform fees go to it as well.

---

## 2. Accounts you need

| Service | Why | Cost to start |
|---|---|---|
| [GitHub](https://github.com) | Holds the code; Vercel deploys from it | Free |
| [Vercel](https://vercel.com) | Hosting + the API function | Hobby is free but meant for non-commercial projects; a business site needs a paid plan (see vercel.com/pricing) |
| [Upstash](https://upstash.com) (via Vercel Storage) | Database | Free tier |
| [Helius](https://helius.dev) (or Triton / QuickNode) | Solana RPC | Free tier for devnet |
| [Pinata](https://pinata.cloud) | Stores coin images and metadata on IPFS | Free tier |
| [Anthropic](https://console.anthropic.com) | Claude for the AI analyst and the AI coin creator | Pay as you go |
| [Pexels](https://www.pexels.com/api/) | Stock photos for the AI coin creator (optional) | Free |
| [Stripe](https://stripe.com) | Pro with card, Apple Pay, Google Pay | Per-transaction fees |
| [MoonPay](https://www.moonpay.com/business) | "Buy SOL with Apple Pay" button (optional) | Needs business approval |
| Phantom or Solflare | To test on devnet | Free |

---

## 3. Deploy to Vercel

1. Create a new **private** GitHub repository and upload this folder (everything except `node_modules/` and `dist/`, which `.gitignore` already excludes).
2. In Vercel: **Add New → Project → Import** the repository. Vercel detects Vite automatically (`vercel.json` sets the build).
3. Before the first deploy, open **Settings → Environment Variables** and add the variables from step 4. You can deploy first and add them afterwards; every change needs a **Redeploy** (Deployments → ⋯ → Redeploy).
4. Add your domain under **Settings → Domains** and set `PUBLIC_SITE_URL` to it (for example `https://supernova.fun`).

---

## 4. Environment variables

`.env.example` lists every variable with a comment. The minimum for a working devnet site:

| Variable | Value |
|---|---|
| `SOLANA_CLUSTER` | `devnet` |
| `RPC_URL` | Helius → Dashboard → RPCs → copy the **devnet** URL (contains your API key) |
| `PUBLIC_SITE_URL` | your site URL, no trailing slash |
| `JWT_SECRET` | 64 random characters (run `openssl rand -hex 32`, or use a password generator) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Vercel → **Storage → Create → Upstash for Redis → Connect to project** adds them for you (`KV_REST_API_URL`/`KV_REST_API_TOKEN` also work) |
| `PINATA_JWT` | Pinata → **API Keys → New Key** (admin, or files write) → copy the **JWT** |
| `ANTHROPIC_API_KEY` | console.anthropic.com → **API Keys** |
| `TREASURY_WALLET`, `ADMIN_WALLETS` | `AwKiYEP8scU4UWF6n7DTjZMMmzXJYtc7HtSr1gB7qGrM` |

Optional: `PEXELS_API_KEY` (photos for the AI coin creator), `PUBLIC_RPC_URL`, Stripe, MoonPay and Jupiter (below).

After deploying, open **`https://your-domain/admin.html`**: the setup checklist shows exactly which variables are still missing.

---

## 5. Create your LaunchLab platform (your fee wallet)

Until you do this, launches use Raydium's default platform and its platform fee goes to Raydium.

1. Install **Phantom** (or Solflare) and import/create the wallet `AwKi…qGrM`.
2. Switch it to devnet: Phantom → Settings → Developer Settings → **Testnet Mode** → Solana Devnet. (Solflare: Settings → Network → Devnet.)
3. Get free devnet SOL: the **Free devnet SOL** button on the site, or [faucet.solana.com](https://faucet.solana.com).
4. Open `/admin.html` → **Connect wallet** → fill in **Create platform**:
   - **Platform fee**: what you earn per trade. 0.5% is a good start (traders pay about 1% in total with LaunchLab's own fee and the creator fee).
   - **Creator fee**: what each coin's creator earns per trade (0.25% default). Creators claim it on their profile.
   - **LP split at graduation**: what share of the locked Raydium liquidity earns trading fees for you, for the creator, or is burned. Must add up to 100%.
   - **Fee wallet**: defaults to the connected wallet.
5. Approve in the wallet (about 0.008 SOL rent). The page shows **Last step: set PLATFORM_ID=…**. Copy that address into Vercel as `PLATFORM_ID` and redeploy.
6. Reload `/admin.html`: the platform shows **Active on this site**. From now on fees from every curve trade of Supernova coins collect in the **Platform fees** panel, where you claim them as SOL.

The platform address depends on the network: when you go to mainnet you create it once more there (step 9).

---

## 6. Stripe: Pro with card, Apple Pay and Google Pay

Do all of this in **test mode** first (toggle in the Stripe dashboard).

1. **Product**: Product catalog → Add product "Supernova Pro" → **Recurring** price, for example $19 / month → copy the price ID (`price_…`) into `STRIPE_PRICE_ID_PRO`.
2. **API key**: Developers → API keys → **Secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
3. **Webhook**: Developers → Webhooks → **Add endpoint**
   - URL: `https://your-domain/api/pro/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`
   - Copy the **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
4. **Apple Pay / Google Pay**: Settings → Payment methods → make sure Apple Pay and Google Pay are on. Stripe Checkout then shows them automatically on supported devices (Safari on iPhone/Mac with a card in Wallet, Chrome with Google Pay). No extra domain setup is needed because Checkout runs on Stripe's page.
5. **Customer portal**: Settings → Billing → Customer portal → activate it, so "Manage billing" lets subscribers cancel or change their card.
6. Redeploy and test with card `4242 4242 4242 4242`, any future date, any CVC.

Stripe reviews businesses connected to crypto. Selling a software subscription (an analytics tool) is usually fine, but describe the product honestly when you activate your account and do not use Stripe to sell tokens.

**Pro paid in SOL** works as soon as `TREASURY_WALLET` is set: the server checks the payment on-chain (amount, recipient, your wallet's signature and a one-time reference) before unlocking Pro. Price and length: `PRO_SOL_PRICE` (default 0.1 SOL) and `PRO_DAYS` (30).

---

## 7. MoonPay: "Buy SOL with Apple Pay" (optional)

MoonPay needs a business account and approval. After approval, set `MOONPAY_PUBLISHABLE_KEY` and `MOONPAY_SECRET_KEY` (use `MOONPAY_BASE_URL=https://buy-sandbox.moonpay.com` with sandbox keys while testing). The site signs every widget URL on the server and opens MoonPay with the user's wallet address filled in. Until it is set up, the button stays hidden, and users can still buy SOL with Apple Pay inside Phantom, Solflare or Trust Wallet.

---

## 8. Devnet test checklist

Use Phantom or Solflare in devnet mode (Trust Wallet has no devnet mode; test it on mainnet with small amounts).

- [ ] Connect the wallet on desktop; on a phone, open the site and use **Open Supernova in Phantom** (the wallet's in-app browser).
- [ ] Get devnet SOL with the button in the header banner.
- [ ] Launch a coin: AI coin creator → photo → small dev buy → approve → "is live".
- [ ] Open it in the terminal: chart, depth, trades and token intel fill in.
- [ ] Buy and sell on the curve; your position and PnL update.
- [ ] AI analyst: "Is this a rug?" (signs a free message once), then the free limit opens the Pro window.
- [ ] Pro with SOL; Pro with the Stripe test card; "Manage billing" opens the portal.
- [ ] Profile → creator rewards → **Claim**.
- [ ] `/admin.html` → platform fees → **Claim**.

---

## 9. Going live on mainnet

Real money from here on. Go step by step:

1. `SOLANA_CLUSTER=mainnet` and a **mainnet** `RPC_URL` (paid Helius plan recommended).
2. On `/admin.html`, with your wallet on mainnet, create the platform again (about 0.008 SOL) and set the new `PLATFORM_ID`.
3. Stripe **live mode**: live secret key, live price ID, a new live webhook endpoint with its own `whsec_…`.
4. Optional: `JUPITER_API_KEY` (portal.jup.ag) for swaps of graduated coins and majors; MoonPay production keys.
5. Redeploy, then repeat the checklist with tiny amounts (0.01 SOL trades).
6. Security: two-factor login on GitHub, Vercel, Stripe, Upstash, Helius, Pinata and Anthropic; keep the admin wallet on a hardware wallet if you can; never paste a seed phrase anywhere.
7. Legal: memecoin launchpads, trading tools and paid "AI signals" are regulated differently in each country (in the EU for example by MiCA, in Germany also BaFin). Before launching publicly, have a lawyer review your terms of service, risk disclaimer, privacy policy and which countries you serve. The site already says "Not financial advice", but that alone is not enough. This guide is not legal advice.

---

## 10. Running it locally

```bash
npm install
npm run dev:mock     # the whole site offline on a simulated chain: no accounts needed
npm run dev          # real devnet: put your variables in .env.local first
npm test             # unit tests (decoders, sign-in, payments, rate limits)
npm run typecheck
npm run build
```

`npm run dev:mock` runs a built-in simulator (wallet, LaunchLab, market data, Claude, Pinata) so you can click through every page. It only exists in development and is never deployed. Browser tests (Python + Playwright) run against the mock server: `python3 tests/e2e/run.py http://localhost:5173` and `python3 tests/e2e/admin.py http://localhost:5173`.

---

## 11. Troubleshooting

| Message | Fix |
|---|---|
| "This feature is not configured yet (missing …)" | Add the named variable in Vercel and redeploy. |
| "Sign-in is not configured yet (JWT_SECRET …)" | `JWT_SECRET` must be at least 32 characters. |
| "This coin was launched on a different platform" | `PLATFORM_ID` changed after the coin was launched, or it belongs to the other network. |
| "LaunchLab is not available on this network" / "platform id not found" | `PLATFORM_ID` points to a platform that does not exist on the current network: create it on `/admin.html` or clear the variable. |
| Wallet shows the wrong network | Phantom: Testnet Mode on for devnet, off for mainnet. |
| "Too many network requests" | The shared RPC budget per visitor was hit; use a paid RPC or set `PUBLIC_RPC_URL` (a domain-locked browser RPC). |
| Launch stuck at "Listing it on Supernova" | The coin exists on-chain; it appears in the list as soon as the RPC returns the transaction (refresh after a minute). |
| AI "busy" or "key not valid" | Check `ANTHROPIC_API_KEY` and your Anthropic billing. |

---

## 12. Security notes

- Non-custodial: wallets sign everything; the server only verifies signatures and on-chain results.
- Sign-in is a free message signature (Sign-In With Solana) with a one-time nonce; the session is an HttpOnly, SameSite cookie.
- Pro is granted only by verified Stripe webhooks/checkout sessions or by an on-chain SOL payment that is checked for amount, recipient, signer, reference key and replays.
- Every cookie-based write checks the request origin; every endpoint has per-IP or per-wallet rate limits; the RPC proxy only allows read methods plus sending signed transactions.
- Coin metadata is read only from IPFS/Arweave gateways (no server-side requests to arbitrary hosts) and every value shown on the page is escaped.
- `vercel.json` sets a strict Content-Security-Policy, HSTS, and frame and referrer protections.
- `npm audit` reports advisories in `bigint-buffer`, a dependency of `@solana/spl-token` with no upstream fix yet; it affects decoding of malformed buffers in Node's native module, which this site does not do with untrusted input. Re-check with `npm audit` when updating dependencies.
