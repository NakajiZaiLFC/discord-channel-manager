import { env } from 'cloudflare:test';
import fs from 'node:fs';

let cachedSchema: string | null = null;

function getSchema(): string {
  if (cachedSchema === null) {
    cachedSchema = fs.readFileSync('./scripts/schema.sql', 'utf8');
  }
  return cachedSchema;
}

export async function applyMigrations(): Promise<void> {
  const stmts = getSchema().split(';').map(s => s.trim()).filter(Boolean);
  for (const sql of stmts) {
    await env.DB.exec(sql);
  }
}
