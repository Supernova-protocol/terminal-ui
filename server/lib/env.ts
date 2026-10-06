/* Server configuration. Every secret lives in environment variables (Vercel → Project → Settings → Environment Variables). */
const e = (k: string, d = '') => (process.env[k] ?? d).trim();
const n = (k: string, d: number) => {
  const raw = process.env[k];
  if (raw == null || raw.trim() === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};
const list = (k: string) => e(k).split(',').map((s) => s.trim()).filter(Boolean);

const cluster = (e('SOLANA_CLUSTER', 'devnet') === 'mainnet' ? 'mainnet' : 'devnet') as 'mainnet' | 'devnet';

export const LAUNCHLAB = {
  mainnet: { program: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', defaultPlatform: '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4', api: 'https://launch-mint-v1.raydium.io', apiV3: 'https://api-v3.raydium.io' },
  devnet: { program: 'DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6', defaultPlatform: '2Jx4KTDrVSdWNazuGpcA8n3ZLTRGGBDxAWhuKe2Xcj2a', api: 'https://launch-mint-v1-devnet.raydium.io', apiV3: 'https://api-v3-devnet.raydium.io' },
} as const;

export const ENV = {
  cluster,
  isVercel: !!process.env.VERCEL,
  rpcUrl: () => e('RPC_URL') || (cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'),
  /** Optional browser-safe RPC (e.g. a Helius "secure RPC" URL locked to your domain). Empty → browser uses /api/rpc. */
  publicRpcUrl: e('PUBLIC_RPC_URL'),
  siteUrl: e('PUBLIC_SITE_URL').replace(/\/$/, ''),
  jwtSecret: () => e('JWT_SECRET'),

  launchProgram: e('LAUNCHLAB_PROGRAM_ID') || LAUNCHLAB[cluster].program,
  platformId: e('PLATFORM_ID') || LAUNCHLAB[cluster].defaultPlatform,
  platformConfigured: !!e('PLATFORM_ID'),
  migrateType: (e('LAUNCH_MIGRATE_TYPE', 'cpmm') === 'amm' ? 'amm' : 'cpmm') as 'amm' | 'cpmm',
  adminWallets: list('ADMIN_WALLETS'),

  upstashUrl: e('UPSTASH_REDIS_REST_URL') || e('KV_REST_API_URL'),
  upstashToken: e('UPSTASH_REDIS_REST_TOKEN') || e('KV_REST_API_TOKEN'),

  anthropicKey: e('ANTHROPIC_API_KEY'),
  modelAnalyst: e('ANTHROPIC_MODEL_ANALYST', 'claude-sonnet-5-5'),
  modelBuilder: e('ANTHROPIC_MODEL_BUILDER', 'claude-haiku-4-5-20251001'),

  pinataJwt: e('PINATA_JWT'),
  pinataGateway: e('PINATA_GATEWAY', 'https://gateway.pinata.cloud').replace(/\/$/, ''),
  pexelsKey: e('PEXELS_API_KEY'),

  stripeSecret: e('STRIPE_SECRET_KEY'),
  stripePricePro: e('STRIPE_PRICE_ID_PRO'),
  stripeWebhookSecret: e('STRIPE_WEBHOOK_SECRET'),
  proPriceLabel: e('PRO_PRICE_LABEL', '$19 / month'),

  treasury: e('TREASURY_WALLET'),
  proSolPrice: n('PRO_SOL_PRICE', 0.1),
  proDays: n('PRO_DAYS', 30),

  moonpayKey: e('MOONPAY_PUBLISHABLE_KEY'),
  moonpaySecret: e('MOONPAY_SECRET_KEY'),
  moonpayBase: e('MOONPAY_BASE_URL', 'https://buy.moonpay.com').replace(/\/$/, ''),

  jupiterUrl: e('JUPITER_API_URL', 'https://api.jup.ag/swap/v2').replace(/\/$/, ''),
  jupiterKey: e('JUPITER_API_KEY'),
  jupReferralAccount: e('JUP_REFERRAL_ACCOUNT'),
  jupReferralFeeBps: n('JUP_REFERRAL_FEE_BPS', 0),
  jitoUrl: e('JITO_URL', 'https://mainnet.block-engine.jito.wtf/api/v1/transactions'),

  freeAnalysesPerDay: n('FREE_ANALYSES_PER_DAY', 1),
  proAnalysesPerDay: n('PRO_ANALYSES_PER_DAY', 150),
  builderPerDay: n('BUILDER_PER_DAY', 30),
};

export function need(...keys: string[]) {
  const missing = keys.filter((k) => !process.env[k] || !String(process.env[k]).trim());
  if (missing.length) throw new HttpError(503, `This feature is not configured yet (missing ${missing.join(', ')}). See SETUP.md.`, 'not_configured');
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
