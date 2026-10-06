import { defineConfig } from 'vitest/config';

// Unit tests for the server code. They run against an in-memory KV and a stubbed fetch, so no accounts are needed.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    env: {
      SOLANA_CLUSTER: 'devnet',
      RPC_URL: 'https://rpc.test.invalid',
      JWT_SECRET: 'unit-test-secret-unit-test-secret-0123456789',
      TREASURY_WALLET: 'J2xccRtuG43drESLYznHhLhQkLTdfepcKYbiQ9BsJVaf',
      PRO_SOL_PRICE: '0.1',
      PRO_DAYS: '30',
      MOONPAY_PUBLISHABLE_KEY: 'pk_test_unit',
      MOONPAY_SECRET_KEY: 'sk_test_unit',
      ADMIN_WALLETS: '',
    },
  },
});
