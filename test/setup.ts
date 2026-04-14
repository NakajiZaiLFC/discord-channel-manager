import { env } from 'cloudflare:test';
import fs from 'node:fs';

export async function applyMigrations(): Promise<void> {
  const schema = fs.readFileSync('./scripts/schema.sql', 'utf8');
  const stmts = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const sql of stmts) {
    await env.DB.exec(sql);
  }
}
