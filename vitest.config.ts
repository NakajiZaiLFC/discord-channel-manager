import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

const poolOptions = {
  wrangler: { configPath: './wrangler.toml' },
  miniflare: {
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat_v2'],
    d1Databases: ['DB'],
  },
};

export default defineConfig({
  plugins: [cloudflareTest(poolOptions)],
  test: {
    globals: true,
    pool: cloudflarePool(poolOptions),
  },
});
