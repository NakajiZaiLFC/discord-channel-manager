import { env } from 'cloudflare:test';
import fs from 'node:fs';
import { beforeEach } from 'vitest';

const schema = fs.readFileSync('./scripts/schema.sql', 'utf8');

beforeEach(async () => {
  const stmts = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const sql of stmts) {
    await env.DB.exec(sql);
  }
});
