import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

const poolOptions = {
  wrangler: { configPath: './wrangler.toml' },
  miniflare: {
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat_v2'],
    d1Databases: ['DB'],
    bindings: {
      GUILD_ID: '100000000000000000',
      ADMIN_ROLE_IDS: '200000000000000000',
      PERSONAL_CHANNELS_CATEGORY_ID: '300000000000000000',
      ARCHIVE_CATEGORY_ID: '400000000000000000',
      ARCHIVE_RETENTION_DAYS: '30',
      LOG_LEVEL: 'info',
      DISCORD_TOKEN: 'test-token',
      DISCORD_PUBLIC_KEY: 'a'.repeat(64),
      DISCORD_APPLICATION_ID: '500000000000000000',
    },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(poolOptions)],
  test: {
    globals: true,
    pool: cloudflarePool(poolOptions),
  },
});
