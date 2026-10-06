# Supernova

Solana memecoin launchpad, trading terminal and AI analyst.

- **Launch** real SPL coins on Raydium LaunchLab bonding curves (fixed 1B supply; the coin graduates to a Raydium pool when the curve fills, 85 SOL by default), with an AI coin creator that writes the name, ticker and pitch and finds a photo.
- **Trade** on the curve from the terminal (live on-chain chart, depth, tape, position and PnL), with Jito-protected sends and Jupiter routing for graduated coins on mainnet.
- **Connect** Phantom, Solflare, Trust Wallet, Backpack and any Wallet Standard wallet, with deep links into the wallets' in-app browsers on phones.
- **AI analyst (Pro)**: "Is this a rug?", "Are whales buying or dumping?", "Best entry & take-profit?" or any question, answered by Claude from real on-chain and market data (dev wallet, holders, authorities, launch snipes, flow, technicals). Levels are drawn on the chart.
- **Pro payments**: card, Apple Pay and Google Pay through Stripe, or SOL from the wallet, verified on-chain. Optional "Buy SOL with Apple Pay" through MoonPay.
- **Revenue**: your own LaunchLab platform fee on every curve trade, claimable as SOL on `/admin.html`.

Non-custodial: users sign every transaction in their own wallet; the server never handles keys or funds.

## Quick start

```bash
npm install
npm run dev:mock   # full site offline on a simulated chain, no accounts needed
```

Then follow **[SETUP.md](SETUP.md)** to deploy on Vercel, connect the services and go from devnet to mainnet.

## Project layout

```
index.html, admin.html     pages (Vite entry points)
src/app.js                 the UI (discover, terminal, launch, profile, Pro)
src/live/                  wallet, chain, LaunchLab, Jupiter and API clients
src/admin.ts               admin page (setup checklist, platform, fees)
api/router.ts              the single Vercel function
server/routes/, server/lib/ API: auth, market data, launches, AI, payments
scripts/mock/              offline simulator for development (never deployed)
tests/unit/, tests/e2e/    Vitest unit tests, Playwright browser tests
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the real API (variables from `.env.local`) |
| `npm run dev:mock` | Dev server on the offline simulator |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |

Not financial advice. Memecoins are extremely risky.
