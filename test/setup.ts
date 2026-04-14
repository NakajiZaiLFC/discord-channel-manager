import { env } from 'cloudflare:test';
// @ts-expect-error — vite "?raw" import: returns file contents as string
import schemaSql from '../scripts/schema.sql?raw';

export async function applyMigrations(): Promise<void> {
  // Reset schema for a clean slate between tests.
  await env.DB.prepare('DROP TABLE IF EXISTS channels').run();
  const stmts = (schemaSql as string)
    .split(';')
    .map((s: string) => s.trim())
    .filter(Boolean);
  for (const sql of stmts) {
    // D1.prepare(...).run() accepts a single statement.
    await env.DB.prepare(sql).run();
  }
}
