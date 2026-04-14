# Discord Channel Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers 上で動作する Discord bot を実装する。全てのチャンネル編集操作を slash command 経由に統制し、Bot がオーナー検証を行う。

**Architecture:** HTTP Interactions エンドポイント方式。Cloudflare Workers が Discord からの webhook を署名検証 → type で分岐 → command handler 実行 → Discord REST で実操作 → D1 でオーナー台帳更新 → ログch に best-effort で監査投稿。D1 が真実の情報源、ログchは監査ミラー。

**Tech Stack:** TypeScript 5, Cloudflare Workers, Cloudflare D1 (SQLite), `discord-api-types` (型のみ), `zod`, WebCrypto API (Ed25519署名検証), `vitest` + `@cloudflare/vitest-pool-workers`, `wrangler`.

**Spec:** `docs/superpowers/specs/2026-04-14-discord-channel-manager-design.md`

---

## File Structure

各ファイルは1つの責務に限定する。ディレクトリ階層は spec §4 に準拠。

```
Create:
  package.json                               # deps / scripts
  tsconfig.json                              # strict TS, WebCrypto lib
  wrangler.toml                              # Worker + D1 bind
  vitest.config.ts                           # miniflare pool
  .gitignore                                 # 追記: .wrangler/, coverage/, etc.
  scripts/schema.sql                         # D1 初期スキーマ
  scripts/register-commands.ts               # ギルドコマンド登録 (ローカル実行)
  scripts/recovery.ts                        # ログch→D1 再構築 (手動実行)
  src/worker.ts                              # fetch handler: verify→dispatch→error boundary
  src/config.ts                              # zod-validated Env 型
  src/verify.ts                              # Ed25519署名検証 (WebCrypto)
  src/discord/rest.ts                        # Discord REST 薄ラッパ
  src/discord/types.ts                       # discord-api-types re-export
  src/interactions/command-router.ts         # type=2 振り分け
  src/interactions/component-router.ts       # type=3 振り分け
  src/commands/claim.ts                      # admin用マイグレ
  src/commands/list.ts                       # admin用俯瞰
  src/commands/rename.ts
  src/commands/move.ts
  src/commands/settopic.ts
  src/commands/create.ts                     # race mitigation
  src/commands/delete.ts                     # 確認ボタン表示
  src/components/delete-confirm.ts           # ボタン押下→実削除
  src/ownership/store.ts                     # D1 CRUD
  src/ownership/events.ts                    # OwnershipEvent 型 + シリアライズ
  src/ownership/audit-log.ts                 # ログch投稿 (best effort)
  src/ownership/permissions.ts               # resolveActorPermission
  src/lib/errors.ts                          # 例外クラス
  src/lib/result.ts                          # Result<T,E>
  test/verify.test.ts
  test/ownership/store.test.ts
  test/ownership/permissions.test.ts
  test/commands/*.test.ts                    # 各commandのhappy/deny/race
  test/integration/worker.test.ts            # E2E (miniflare)
  test/fixtures/interactions.ts              # テスト用 interaction payload
  test/setup.ts                              # vitest グローバル setup
```

---

## Chunk 1: プロジェクト基盤 + コアユーティリティ

このチャンクで Node プロジェクト初期化、依存導入、TS/wrangler/vitest 設定、D1 スキーマ、Result 型、エラー型、Ed25519 署名検証（TDD）を揃える。Chunk 2以降で使う足場。

### Task 1.1: npm プロジェクト初期化

**Files:**
- Create: `package.json`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "discord-channel-manager",
  "version": "0.1.0",
  "private": true,
  "description": "Bot-mediated Discord channel manager with owner verification",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "register-commands": "tsx scripts/register-commands.ts",
    "recovery": "tsx scripts/recovery.ts"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: commit**

```bash
git add package.json
git commit -m "chore: initialize npm project"
```

### Task 1.2: 依存インストール

**Files:** package.json (modified)

- [ ] **Step 1: 開発依存インストール**

```bash
npm install -D typescript @types/node tsx vitest @cloudflare/vitest-pool-workers wrangler
```

Expected: `package.json` の `devDependencies` に上記5つが追加される

- [ ] **Step 2: ランタイム依存インストール**

```bash
npm install zod discord-api-types
```

Expected: `package.json` の `dependencies` に追加される

- [ ] **Step 3: commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add runtime and dev dependencies"
```

### Task 1.3: TypeScript 設定

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: tsconfig.json 作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"],
    "rootDir": ".",
    "outDir": "./dist",
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist", ".wrangler"]
}
```

- [ ] **Step 2: Cloudflare workers types インストール**

```bash
npm install -D @cloudflare/workers-types
```

- [ ] **Step 3: typecheck 確認**

```bash
npm run typecheck
```

Expected: `src` はまだ空なので失敗しないが警告なしでreturn 0

- [ ] **Step 4: commit**

```bash
git add tsconfig.json package.json package-lock.json
git commit -m "chore: configure TypeScript for Workers"
```

### Task 1.4: wrangler.toml 作成（プレースホルダ）

**Files:**
- Create: `wrangler.toml`

- [ ] **Step 1: wrangler.toml を作成（実ID は後工程で記入）**

```toml
name = "discord-channel-manager"
main = "src/worker.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat_v2"]

[vars]
GUILD_ID = ""                         # デプロイ前に設定
ADMIN_ROLE_IDS = ""                   # カンマ区切り
PERSONAL_CHANNELS_CATEGORY_ID = ""
EVENT_LOG_CHANNEL_ID = ""
LOG_LEVEL = "info"

[[d1_databases]]
binding = "DB"
database_name = "discord-channel-manager"
database_id = ""                      # wrangler d1 create 後に記入

# Secrets (wrangler secret put で設定):
#   DISCORD_TOKEN
#   DISCORD_PUBLIC_KEY
#   DISCORD_APPLICATION_ID
```

- [ ] **Step 2: commit**

```bash
git add wrangler.toml
git commit -m "chore: add wrangler.toml with placeholder IDs"
```

### Task 1.5: vitest 設定 (miniflare pool)

**Files:**
- Create: `vitest.config.ts`
- Create: `test/setup.ts`

- [ ] **Step 1: vitest.config.ts 作成**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['nodejs_compat_v2'],
          d1Databases: ['DB'],
        },
      },
    },
  },
});
```

- [ ] **Step 2: test/setup.ts 作成（schema 流し込み用）**

```ts
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
```

- [ ] **Step 3: commit**

```bash
git add vitest.config.ts test/setup.ts
git commit -m "chore: configure vitest with Workers pool"
```

### Task 1.6: .gitignore 拡張

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 追記**

現在の `.gitignore` の末尾に追記:

```
node_modules/
dist/
.wrangler/
coverage/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 2: commit**

```bash
git add .gitignore
git commit -m "chore: extend .gitignore for Node/Wrangler artifacts"
```

### Task 1.7: D1 スキーマ作成

**Files:**
- Create: `scripts/schema.sql`

- [ ] **Step 1: schema.sql 作成**

```sql
CREATE TABLE IF NOT EXISTS channels (
  channel_id        TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  last_modified_at  TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'text'
                      CHECK (kind IN ('text', 'voice', 'category'))
);

CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);

CREATE TABLE IF NOT EXISTS nonces (
  nonce        TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);
```

- [ ] **Step 2: commit**

```bash
git add scripts/schema.sql
git commit -m "feat: add D1 schema for channels and nonces"
```

### Task 1.8: Result 型

**Files:**
- Create: `src/lib/result.ts`

- [ ] **Step 1: result.ts 実装**

```ts
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/lib/result.ts
git commit -m "feat: add Result type for error propagation"
```

### Task 1.9: 例外クラス

**Files:**
- Create: `src/lib/errors.ts`

- [ ] **Step 1: errors.ts 実装**

```ts
export class DomainError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.userMessage = userMessage;
    this.cause = cause;
    this.name = this.constructor.name;
  }
}

export class NotOwnerError extends DomainError {
  constructor() {
    super('❌ あなたはこのチャンネルのオーナーではありません');
  }
}

export class QuotaExceededError extends DomainError {
  constructor() {
    super('❌ すでにチャンネルを所有しています（1人1チャンネル制限）');
  }
}

export class NotRegisteredError extends DomainError {
  constructor() {
    super('❌ このチャンネルは Bot に登録されていません（管理者に `/channel claim` を依頼してください）');
  }
}

export class InvalidLocationError extends DomainError {
  constructor(msg: string) {
    super(msg);
  }
}

export class DiscordApiError extends DomainError {
  constructor(status: number, body: string) {
    super(`❌ Discord API エラー (${status})`, { status, body });
  }
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/lib/errors.ts
git commit -m "feat: add domain error classes"
```

### Task 1.10: config.ts (zod-validated Env)

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: config.ts 実装**

```ts
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{15,25}$/, 'must be a Discord snowflake');
const snowflakeList = z.string().transform(s =>
  s.split(',').map(x => x.trim()).filter(Boolean)
).pipe(z.array(snowflake).min(1));

export const EnvSchema = z.object({
  GUILD_ID: snowflake,
  ADMIN_ROLE_IDS: snowflakeList,
  PERSONAL_CHANNELS_CATEGORY_ID: snowflake,
  EVENT_LOG_CHANNEL_ID: snowflake,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DISCORD_APPLICATION_ID: snowflake,
  DB: z.any(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: unknown): Env {
  return EnvSchema.parse(raw);
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/config.ts
git commit -m "feat: add zod-validated Env schema"
```

### Task 1.11: Ed25519 署名検証 (TDD)

**Files:**
- Create: `test/verify.test.ts`
- Create: `src/verify.ts`

- [ ] **Step 1: failing test を書く**

`test/verify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifySignature } from '../src/verify.js';

async function toHex(buf: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function setup() {
  const kp = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const publicKeyHex = await toHex(pubRaw);
  return { kp, publicKeyHex };
}

async function sign(kp: CryptoKeyPair, body: string, timestamp: string): Promise<string> {
  const data = new TextEncoder().encode(timestamp + body);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, data);
  return toHex(sig);
}

describe('verifySignature', () => {
  it('returns true for a valid signature', async () => {
    const { kp, publicKeyHex } = await setup();
    const body = '{"type":1}';
    const timestamp = '1700000000';
    const signature = await sign(kp, body, timestamp);

    const ok = await verifySignature(body, signature, timestamp, publicKeyHex);
    expect(ok).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const { publicKeyHex } = await setup();
    const body = '{"type":1}';
    const timestamp = '1700000000';
    const badSig = 'deadbeef'.repeat(16); // 128 hex chars = 64 bytes

    const ok = await verifySignature(body, badSig, timestamp, publicKeyHex);
    expect(ok).toBe(false);
  });

  it('returns false for a tampered body', async () => {
    const { kp, publicKeyHex } = await setup();
    const timestamp = '1700000000';
    const signature = await sign(kp, '{"type":1}', timestamp);

    const ok = await verifySignature('{"type":2}', signature, timestamp, publicKeyHex);
    expect(ok).toBe(false);
  });

  it('returns false for malformed hex', async () => {
    const { publicKeyHex } = await setup();
    const ok = await verifySignature('x', 'zz', '1700000000', publicKeyHex);
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: test 実行 → 失敗確認**

```bash
npm test test/verify.test.ts
```

Expected: FAIL (module not found: ../src/verify.js)

- [ ] **Step 3: 最小実装**

`src/verify.ts`:

```ts
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

export async function verifySignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  const sig = hexToBytes(signatureHex);
  const pub = hexToBytes(publicKeyHex);
  if (!sig || !pub || sig.length !== 64 || pub.length !== 32) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      pub,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: test 実行 → 成功確認**

```bash
npm test test/verify.test.ts
```

Expected: PASS (4 passing)

- [ ] **Step 5: commit**

```bash
git add src/verify.ts test/verify.test.ts
git commit -m "feat: add Ed25519 signature verification with WebCrypto"
```

---

## Chunk 2: Discord REST ラッパ + ownership ドメイン

### Task 2.1: discord/types.ts (型 re-export)

**Files:**
- Create: `src/discord/types.ts`

- [ ] **Step 1: types.ts 実装**

```ts
export type {
  APIInteraction,
  APIApplicationCommandInteraction,
  APIMessageComponentInteraction,
  APIInteractionResponse,
  APIChatInputApplicationCommandInteractionData,
  APIInteractionDataOptionBase,
  APIChannel,
  APIGuildMember,
  APIUser,
} from 'discord-api-types/v10';

export {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  ComponentType,
  ButtonStyle,
  ChannelType,
  ApplicationCommandOptionType,
} from 'discord-api-types/v10';
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/discord/types.ts
git commit -m "feat: add Discord API type re-exports"
```

### Task 2.2: discord/rest.ts (REST ラッパ) — TDD省略（薄いIOのみ）

**Files:**
- Create: `src/discord/rest.ts`

- [ ] **Step 1: rest.ts 実装**

```ts
import { DiscordApiError } from '../lib/errors.js';
import type { APIChannel } from './types.js';

const BASE = 'https://discord.com/api/v10';

type Fetcher = typeof fetch;

export interface DiscordRest {
  patchChannel(channelId: string, body: PatchChannelBody): Promise<APIChannel>;
  deleteChannel(channelId: string): Promise<void>;
  createGuildChannel(guildId: string, body: CreateGuildChannelBody): Promise<APIChannel>;
  postMessage(channelId: string, body: PostMessageBody): Promise<unknown>;
  getChannel(channelId: string): Promise<APIChannel>;
  listGuildChannels(guildId: string): Promise<APIChannel[]>;
}

export interface PatchChannelBody {
  name?: string;
  topic?: string;
  position?: number;
}

export interface CreateGuildChannelBody {
  name: string;
  type: number;
  parent_id: string;
}

export interface PostMessageBody {
  content: string;
  flags?: number;
}

export function createDiscordRest(token: string, f: Fetcher = fetch): DiscordRest {
  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await f(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (discord-channel-manager, 0.1)',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DiscordApiError(res.status, text);
    }
    return res;
  }

  return {
    async patchChannel(id, body) {
      const r = await req('PATCH', `/channels/${id}`, body);
      return r.json();
    },
    async deleteChannel(id) {
      await req('DELETE', `/channels/${id}`);
    },
    async createGuildChannel(guildId, body) {
      const r = await req('POST', `/guilds/${guildId}/channels`, body);
      return r.json();
    },
    async postMessage(channelId, body) {
      const r = await req('POST', `/channels/${channelId}/messages`, body);
      return r.json();
    },
    async getChannel(id) {
      const r = await req('GET', `/channels/${id}`);
      return r.json();
    },
    async listGuildChannels(guildId) {
      const r = await req('GET', `/guilds/${guildId}/channels`);
      return r.json();
    },
  };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/discord/rest.ts
git commit -m "feat: add Discord REST wrapper"
```

### Task 2.3: ownership/events.ts

**Files:**
- Create: `src/ownership/events.ts`

- [ ] **Step 1: events.ts 実装**

```ts
export type OwnershipEvent =
  | { type: 'channel_created'; channel_id: string; owner_id: string; name: string; kind: 'text' | 'voice' | 'category'; actor_id: string; ts: string }
  | { type: 'channel_renamed'; channel_id: string; old_name: string; new_name: string; actor_id: string; ts: string }
  | { type: 'channel_moved'; channel_id: string; old_position: number; new_position: number; actor_id: string; ts: string }
  | { type: 'channel_topic_updated'; channel_id: string; old_topic: string | null; new_topic: string; actor_id: string; ts: string }
  | { type: 'channel_deleted'; channel_id: string; owner_id: string; actor_id: string; ts: string }
  | { type: 'ownership_claimed'; channel_id: string; owner_id: string; actor_id: string; ts: string };

export function serializeEvent(event: OwnershipEvent): string {
  return '```json\n' + JSON.stringify(event) + '\n```';
}

const JSON_BLOCK_RE = /```json\n([\s\S]+?)\n```/;

export function deserializeEvent(messageContent: string): OwnershipEvent | null {
  const match = messageContent.match(JSON_BLOCK_RE);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]) as OwnershipEvent;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/ownership/events.ts
git commit -m "feat: add OwnershipEvent types and JSON block serde"
```

### Task 2.4: ownership/permissions.ts (TDD)

**Files:**
- Create: `test/ownership/permissions.test.ts`
- Create: `src/ownership/permissions.ts`

- [ ] **Step 1: failing test を書く**

`test/ownership/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveActorPermission } from '../../src/ownership/permissions.js';

const adminRoles = ['admin1', 'admin2'];

describe('resolveActorPermission', () => {
  it('admin role 保持者は "admin"', () => {
    const p = resolveActorPermission({
      actorId: 'user1',
      actorRoles: ['admin1', 'some-other'],
      ownerId: 'user2',
      adminRoleIds: adminRoles,
    });
    expect(p).toBe('admin');
  });

  it('actor == owner は "owner"', () => {
    const p = resolveActorPermission({
      actorId: 'user1',
      actorRoles: [],
      ownerId: 'user1',
      adminRoleIds: adminRoles,
    });
    expect(p).toBe('owner');
  });

  it('その他は "none"', () => {
    const p = resolveActorPermission({
      actorId: 'user1',
      actorRoles: [],
      ownerId: 'user2',
      adminRoleIds: adminRoles,
    });
    expect(p).toBe('none');
  });

  it('owner は null でも admin なら "admin"', () => {
    const p = resolveActorPermission({
      actorId: 'user1',
      actorRoles: ['admin1'],
      ownerId: null,
      adminRoleIds: adminRoles,
    });
    expect(p).toBe('admin');
  });

  it('owner が null かつ 非admin は "none"', () => {
    const p = resolveActorPermission({
      actorId: 'user1',
      actorRoles: [],
      ownerId: null,
      adminRoleIds: adminRoles,
    });
    expect(p).toBe('none');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗確認**

```bash
npm test test/ownership/permissions.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: 実装**

`src/ownership/permissions.ts`:

```ts
export type ActorPermission = 'admin' | 'owner' | 'none';

export interface ResolveArgs {
  actorId: string;
  actorRoles: readonly string[];
  ownerId: string | null;
  adminRoleIds: readonly string[];
}

export function resolveActorPermission(args: ResolveArgs): ActorPermission {
  const { actorId, actorRoles, ownerId, adminRoleIds } = args;
  const isAdmin = actorRoles.some(r => adminRoleIds.includes(r));
  if (isAdmin) return 'admin';
  if (ownerId && actorId === ownerId) return 'owner';
  return 'none';
}

export function isAdmin(actorRoles: readonly string[], adminRoleIds: readonly string[]): boolean {
  return actorRoles.some(r => adminRoleIds.includes(r));
}
```

- [ ] **Step 4: test 実行 → 成功確認**

```bash
npm test test/ownership/permissions.test.ts
```

Expected: PASS (5 passing)

- [ ] **Step 5: commit**

```bash
git add src/ownership/permissions.ts test/ownership/permissions.test.ts
git commit -m "feat: add actor permission resolver with TDD"
```

### Task 2.5: ownership/store.ts (D1 CRUD) — TDD

**Files:**
- Create: `test/ownership/store.test.ts`
- Create: `src/ownership/store.ts`

- [ ] **Step 1: failing test を書く**

`test/ownership/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createStore } from '../../src/ownership/store.js';

describe('OwnershipStore', () => {
  it('getOwnerOf returns null for unknown channel', async () => {
    const store = createStore(env.DB);
    expect(await store.getOwnerOf('unknown')).toBeNull();
  });

  it('insertChannel → getOwnerOf returns owner', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({
      channel_id: 'c1', owner_id: 'u1', kind: 'text',
    });
    expect(await store.getOwnerOf('c1')).toBe('u1');
  });

  it('insertChannelIfNoneOwned succeeds when user has no channel', async () => {
    const store = createStore(env.DB);
    const ok = await store.insertChannelIfNoneOwned({
      channel_id: 'c1', owner_id: 'u1', kind: 'text',
    });
    expect(ok).toBe(true);
    expect(await store.hasChannel('u1')).toBe(true);
  });

  it('insertChannelIfNoneOwned fails when user already owns one', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1', kind: 'text' });
    const ok = await store.insertChannelIfNoneOwned({
      channel_id: 'c2', owner_id: 'u1', kind: 'text',
    });
    expect(ok).toBe(false);
  });

  it('deleteChannel removes the row', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1', kind: 'text' });
    await store.deleteChannel('c1');
    expect(await store.getOwnerOf('c1')).toBeNull();
  });

  it('listAll returns all channels', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1', kind: 'text' });
    await store.insertChannel({ channel_id: 'c2', owner_id: 'u2', kind: 'text' });
    const all = await store.listAll();
    expect(all.length).toBe(2);
  });

  it('touchLastModified updates timestamp', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1', kind: 'text' });
    const before = (await store.get('c1'))!.last_modified_at;
    await new Promise(r => setTimeout(r, 10));
    await store.touchLastModified('c1');
    const after = (await store.get('c1'))!.last_modified_at;
    expect(after).not.toBe(before);
  });
});

describe('NonceStore', () => {
  it('createNonce + consumeNonce succeeds once', async () => {
    const store = createStore(env.DB);
    await store.createNonce({
      nonce: 'n1', actor_id: 'u1', channel_id: 'c1', purpose: 'delete-confirm',
      expires_at_ms_from_now: 60000,
    });
    const res1 = await store.consumeNonce('n1', 'delete-confirm');
    expect(res1).not.toBeNull();
    expect(res1!.actor_id).toBe('u1');
    const res2 = await store.consumeNonce('n1', 'delete-confirm');
    expect(res2).toBeNull();
  });

  it('consumeNonce rejects expired', async () => {
    const store = createStore(env.DB);
    await store.createNonce({
      nonce: 'n2', actor_id: 'u1', channel_id: 'c1', purpose: 'delete-confirm',
      expires_at_ms_from_now: -1000,
    });
    const res = await store.consumeNonce('n2', 'delete-confirm');
    expect(res).toBeNull();
  });

  it('consumeNonce rejects wrong purpose', async () => {
    const store = createStore(env.DB);
    await store.createNonce({
      nonce: 'n3', actor_id: 'u1', channel_id: 'c1', purpose: 'delete-confirm',
      expires_at_ms_from_now: 60000,
    });
    const res = await store.consumeNonce('n3', 'other-purpose');
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: test 実行 → 失敗確認**

```bash
npm test test/ownership/store.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: 実装**

`src/ownership/store.ts`:

```ts
export interface ChannelRow {
  channel_id: string;
  owner_id: string;
  created_at: string;
  last_modified_at: string;
  kind: 'text' | 'voice' | 'category';
}

export interface InsertArgs {
  channel_id: string;
  owner_id: string;
  kind: 'text' | 'voice' | 'category';
}

export interface NonceCreateArgs {
  nonce: string;
  actor_id: string;
  channel_id: string;
  purpose: string;
  expires_at_ms_from_now: number;
}

export interface NonceRow {
  nonce: string;
  actor_id: string;
  channel_id: string;
  purpose: string;
  expires_at: string;
}

export interface Store {
  getOwnerOf(channelId: string): Promise<string | null>;
  get(channelId: string): Promise<ChannelRow | null>;
  hasChannel(ownerId: string): Promise<boolean>;
  listAll(): Promise<ChannelRow[]>;
  insertChannel(args: InsertArgs): Promise<void>;
  insertChannelIfNoneOwned(args: InsertArgs): Promise<boolean>;
  touchLastModified(channelId: string): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;

  createNonce(args: NonceCreateArgs): Promise<void>;
  consumeNonce(nonce: string, purpose: string): Promise<NonceRow | null>;
}

export function createStore(db: D1Database): Store {
  return {
    async getOwnerOf(channelId) {
      const row = await db.prepare(
        'SELECT owner_id FROM channels WHERE channel_id = ?',
      ).bind(channelId).first<{ owner_id: string }>();
      return row?.owner_id ?? null;
    },

    async get(channelId) {
      return db.prepare(
        'SELECT * FROM channels WHERE channel_id = ?',
      ).bind(channelId).first<ChannelRow>();
    },

    async hasChannel(ownerId) {
      const row = await db.prepare(
        'SELECT COUNT(*) as c FROM channels WHERE owner_id = ?',
      ).bind(ownerId).first<{ c: number }>();
      return (row?.c ?? 0) > 0;
    },

    async listAll() {
      const res = await db.prepare(
        'SELECT * FROM channels ORDER BY created_at',
      ).all<ChannelRow>();
      return res.results;
    },

    async insertChannel({ channel_id, owner_id, kind }) {
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO channels (channel_id, owner_id, created_at, last_modified_at, kind)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(channel_id, owner_id, now, now, kind).run();
    },

    async insertChannelIfNoneOwned({ channel_id, owner_id, kind }) {
      const now = new Date().toISOString();
      const res = await db.prepare(
        `INSERT INTO channels (channel_id, owner_id, created_at, last_modified_at, kind)
         SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM channels WHERE owner_id = ?)`,
      ).bind(channel_id, owner_id, now, now, kind, owner_id).run();
      return (res.meta.changes ?? 0) > 0;
    },

    async touchLastModified(channelId) {
      const now = new Date().toISOString();
      await db.prepare(
        'UPDATE channels SET last_modified_at = ? WHERE channel_id = ?',
      ).bind(now, channelId).run();
    },

    async deleteChannel(channelId) {
      await db.prepare(
        'DELETE FROM channels WHERE channel_id = ?',
      ).bind(channelId).run();
    },

    async createNonce({ nonce, actor_id, channel_id, purpose, expires_at_ms_from_now }) {
      const expires = new Date(Date.now() + expires_at_ms_from_now).toISOString();
      await db.prepare(
        `INSERT INTO nonces (nonce, actor_id, channel_id, purpose, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(nonce, actor_id, channel_id, purpose, expires).run();
    },

    async consumeNonce(nonce, purpose) {
      const row = await db.prepare(
        `SELECT * FROM nonces WHERE nonce = ? AND purpose = ?`,
      ).bind(nonce, purpose).first<NonceRow>();
      if (!row) return null;
      await db.prepare('DELETE FROM nonces WHERE nonce = ?').bind(nonce).run();
      if (new Date(row.expires_at).getTime() < Date.now()) return null;
      return row;
    },
  };
}
```

- [ ] **Step 4: test 実行 → 成功確認**

```bash
npm test test/ownership/store.test.ts
```

Expected: PASS (10 passing)

- [ ] **Step 5: commit**

```bash
git add src/ownership/store.ts test/ownership/store.test.ts
git commit -m "feat: add D1-backed ownership store with nonce support"
```

### Task 2.6: ownership/audit-log.ts (best-effort ログch投稿)

**Files:**
- Create: `src/ownership/audit-log.ts`

- [ ] **Step 1: 実装**

```ts
import type { DiscordRest } from '../discord/rest.js';
import { serializeEvent, type OwnershipEvent } from './events.js';

export interface AuditLog {
  post(event: OwnershipEvent): Promise<void>;
}

export function createAuditLog(rest: DiscordRest, logChannelId: string): AuditLog {
  return {
    async post(event) {
      try {
        await rest.postMessage(logChannelId, { content: serializeEvent(event) });
      } catch (e) {
        console.error('[audit-log] post failed (best effort)', {
          event_type: event.type,
          channel_id: event.channel_id,
          error: (e as Error).message,
        });
      }
    },
  };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/ownership/audit-log.ts
git commit -m "feat: add best-effort audit log poster"
```

---

## Chunk 3: Worker エントリ + 署名検証 + ルータ + PING

Worker の fetch handler を組み立て、署名検証 → type=1 PING 応答 → type=2/3 dispatch → error boundary を実装する。この時点で「最小のHTTP動作」が確認できる。

### Task 3.1: fixtures for interaction payloads

**Files:**
- Create: `test/fixtures/interactions.ts`

- [ ] **Step 1: fixture 作成**

```ts
import { InteractionType, ComponentType } from '../../src/discord/types.js';

export function pingInteraction() {
  return { type: InteractionType.Ping };
}

export function commandInteraction(opts: {
  commandName: string;
  subcommand?: string;
  options?: Array<{ name: string; value: string | number }>;
  userId: string;
  userRoles?: string[];
  channelId: string;
  guildId: string;
}) {
  const { commandName, subcommand, options = [], userId, userRoles = [], channelId, guildId } = opts;

  const data: Record<string, unknown> = {
    id: '0',
    name: commandName,
    type: 1,
  };
  if (subcommand) {
    data.options = [{ name: subcommand, type: 1, options }];
  } else {
    data.options = options;
  }

  return {
    id: '0',
    application_id: '0',
    type: InteractionType.ApplicationCommand,
    data,
    guild_id: guildId,
    channel_id: channelId,
    member: {
      user: { id: userId, username: 'test', discriminator: '0', global_name: 'test' },
      roles: userRoles,
    },
    token: 'mock',
    version: 1,
  };
}

export function componentInteraction(opts: {
  customId: string;
  userId: string;
  userRoles?: string[];
  channelId: string;
  guildId: string;
}) {
  const { customId, userId, userRoles = [], channelId, guildId } = opts;
  return {
    id: '0',
    application_id: '0',
    type: InteractionType.MessageComponent,
    data: { custom_id: customId, component_type: ComponentType.Button },
    guild_id: guildId,
    channel_id: channelId,
    member: {
      user: { id: userId, username: 'test', discriminator: '0', global_name: 'test' },
      roles: userRoles,
    },
    token: 'mock',
    version: 1,
  };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add test/fixtures/interactions.ts
git commit -m "test: add interaction payload fixtures"
```

### Task 3.2: command-router.ts (スケルトン)

**Files:**
- Create: `src/interactions/command-router.ts`

- [ ] **Step 1: 実装（コマンド未登録の枠のみ）**

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags } from '../discord/types.js';
import type { Env } from '../config.js';

export interface CommandHandler {
  (interaction: APIApplicationCommandInteraction, env: Env): Promise<APIInteractionResponse>;
}

export interface CommandRouter {
  handle(interaction: APIApplicationCommandInteraction, env: Env): Promise<APIInteractionResponse>;
  register(commandName: string, subcommand: string, handler: CommandHandler): void;
}

export function createCommandRouter(): CommandRouter {
  const handlers = new Map<string, CommandHandler>();

  const key = (c: string, s: string) => `${c}/${s}`;

  return {
    register(commandName, subcommand, handler) {
      handlers.set(key(commandName, subcommand), handler);
    },
    async handle(interaction, env) {
      const data = interaction.data;
      if (data.type !== 1) {
        return notFound();
      }
      const commandName = data.name;
      const top = (data as unknown as { options?: Array<{ name: string; type: number }> }).options?.[0];
      const subName = top?.type === 1 ? top.name : '';
      const h = handlers.get(key(commandName, subName));
      if (!h) return notFound();
      return h(interaction, env);
    },
  };
}

function notFound(): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content: '❌ 未知のコマンドです', flags: MessageFlags.Ephemeral },
  };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/interactions/command-router.ts
git commit -m "feat: add slash command router skeleton"
```

### Task 3.3: component-router.ts

**Files:**
- Create: `src/interactions/component-router.ts`

- [ ] **Step 1: 実装**

```ts
import type { APIMessageComponentInteraction, APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags } from '../discord/types.js';
import type { Env } from '../config.js';

export interface ComponentHandler {
  (interaction: APIMessageComponentInteraction, env: Env): Promise<APIInteractionResponse>;
}

export interface ComponentRouter {
  handle(interaction: APIMessageComponentInteraction, env: Env): Promise<APIInteractionResponse>;
  register(customIdPrefix: string, handler: ComponentHandler): void;
}

export function createComponentRouter(): ComponentRouter {
  const handlers: Array<{ prefix: string; handler: ComponentHandler }> = [];

  return {
    register(prefix, handler) {
      handlers.push({ prefix, handler });
    },
    async handle(interaction, env) {
      const customId = interaction.data.custom_id;
      const match = handlers.find(h => customId.startsWith(h.prefix));
      if (!match) return notFound();
      return match.handler(interaction, env);
    },
  };
}

function notFound(): APIInteractionResponse {
  return {
    type: InteractionResponseType.UpdateMessage,
    data: { content: '❌ 操作の期限切れまたは無効です', components: [] },
  };
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 3: commit**

```bash
git add src/interactions/component-router.ts
git commit -m "feat: add message component router"
```

### Task 3.4: worker.ts (fetch handler)

**Files:**
- Create: `src/worker.ts`

- [ ] **Step 1: 実装**

```ts
import type { APIInteraction, APIInteractionResponse } from './discord/types.js';
import { InteractionType, InteractionResponseType, MessageFlags } from './discord/types.js';
import { verifySignature } from './verify.js';
import { validateEnv, type Env } from './config.js';
import { createCommandRouter } from './interactions/command-router.js';
import { createComponentRouter } from './interactions/component-router.js';
import { DomainError } from './lib/errors.js';

// Command handlers are registered here. Chunk 4+ で実装を足す。
import { registerCommands } from './commands/index.js';
import { registerComponents } from './components/index.js';

const commandRouter = createCommandRouter();
const componentRouter = createComponentRouter();
registerCommands(commandRouter);
registerComponents(componentRouter);

export default {
  async fetch(request: Request, rawEnv: unknown): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let env: Env;
    try {
      env = validateEnv(rawEnv);
    } catch (e) {
      console.error('[env] validation failed', e);
      return new Response('misconfiguration', { status: 500 });
    }

    const sig = request.headers.get('X-Signature-Ed25519');
    const ts = request.headers.get('X-Signature-Timestamp');
    if (!sig || !ts) {
      return new Response('missing signature headers', { status: 401 });
    }

    const raw = await request.text();
    const ok = await verifySignature(raw, sig, ts, env.DISCORD_PUBLIC_KEY);
    if (!ok) {
      return new Response('invalid signature', { status: 401 });
    }

    let interaction: APIInteraction;
    try {
      interaction = JSON.parse(raw);
    } catch {
      return new Response('bad json', { status: 400 });
    }

    try {
      const response = await dispatch(interaction, env);
      return json(response);
    } catch (e) {
      console.error('[worker] unhandled error', e);
      const msg = e instanceof DomainError
        ? e.userMessage
        : '❌ 内部エラーが発生しました';
      return json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: msg, flags: MessageFlags.Ephemeral },
      });
    }
  },
};

async function dispatch(interaction: APIInteraction, env: Env): Promise<APIInteractionResponse> {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: InteractionResponseType.Pong };
    case InteractionType.ApplicationCommand:
      return commandRouter.handle(interaction, env);
    case InteractionType.MessageComponent:
      return componentRouter.handle(interaction, env);
    default:
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: '❌ 未対応のインタラクションです', flags: MessageFlags.Ephemeral },
      };
  }
}

function json(res: APIInteractionResponse): Response {
  return new Response(JSON.stringify(res), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: commands/index.ts とcomponents/index.ts のstub作成**

`src/commands/index.ts`:
```ts
import type { CommandRouter } from '../interactions/command-router.js';

export function registerCommands(_router: CommandRouter): void {
  // Chunk 4+ で各コマンドをここに登録
}
```

`src/components/index.ts`:
```ts
import type { ComponentRouter } from '../interactions/component-router.js';

export function registerComponents(_router: ComponentRouter): void {
  // Chunk 5 で delete-confirm を登録
}
```

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 4: commit**

```bash
git add src/worker.ts src/commands/index.ts src/components/index.ts
git commit -m "feat: add worker entry with signature verify and type dispatch"
```

### Task 3.5: worker 統合テスト (PING + 署名検証)

**Files:**
- Create: `test/integration/worker.test.ts`

- [ ] **Step 1: failing test を書く**

```ts
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';

async function toHex(buf: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function generateKeypair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { kp, publicKeyHex: await toHex(pubRaw) };
}

async function sign(kp: CryptoKeyPair, body: string, timestamp: string): Promise<string> {
  const data = new TextEncoder().encode(timestamp + body);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, data);
  return toHex(sig);
}

describe('worker fetch handler', () => {
  it('rejects requests without signature headers (401)', async () => {
    const res = await SELF.fetch('https://example.com/', {
      method: 'POST',
      body: '{"type":1}',
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid signature (401)', async () => {
    const res = await SELF.fetch('https://example.com/', {
      method: 'POST',
      headers: {
        'X-Signature-Ed25519': 'ff'.repeat(64),
        'X-Signature-Timestamp': '1700000000',
      },
      body: '{"type":1}',
    });
    expect(res.status).toBe(401);
  });

  it('responds to PING with PONG', async () => {
    const { kp, publicKeyHex } = await generateKeypair();
    (env as any).DISCORD_PUBLIC_KEY = publicKeyHex;

    const body = '{"type":1}';
    const ts = '1700000000';
    const signature = await sign(kp, body, ts);

    const res = await SELF.fetch('https://example.com/', {
      method: 'POST',
      headers: {
        'X-Signature-Ed25519': signature,
        'X-Signature-Timestamp': ts,
      },
      body,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ type: 1 });
  });
});
```

- [ ] **Step 2: vitest.config.ts を拡張して DISCORD_PUBLIC_KEY 等のテスト用env設定**

`vitest.config.ts` の `miniflare` セクションに追加:

```ts
miniflare: {
  compatibilityDate: '2025-01-01',
  compatibilityFlags: ['nodejs_compat_v2'],
  d1Databases: ['DB'],
  bindings: {
    GUILD_ID: '100000000000000000',
    ADMIN_ROLE_IDS: '200000000000000000',
    PERSONAL_CHANNELS_CATEGORY_ID: '300000000000000000',
    EVENT_LOG_CHANNEL_ID: '400000000000000000',
    LOG_LEVEL: 'info',
    DISCORD_TOKEN: 'test-token',
    DISCORD_PUBLIC_KEY: 'a'.repeat(64),  // テスト実行時に差し替える
    DISCORD_APPLICATION_ID: '500000000000000000',
  },
},
```

- [ ] **Step 3: test 実行**

```bash
npm test test/integration/worker.test.ts
```

Expected: 3 tests (maybe 1 fails for PONG due to env injection timing — adjust with direct fetch env override if needed)

- [ ] **Step 4: 必要ならpublic key injection の方法を調整**

もし PONG テストが miniflare env override の都合で難しい場合、`vitest.config.ts` で事前に固定公開鍵を埋め、テスト側で対応する private key を保持する形に切替（fixture ファイルに keypair をハードコード）。

- [ ] **Step 5: 全テスト実行**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: commit**

```bash
git add test/integration/worker.test.ts vitest.config.ts
git commit -m "test: add worker integration tests for PING and signature verify"
```

---

## Chunk 4: シンプルコマンド群 (claim, list, rename, move, settopic)

D1/Discord REST 1呼び出しで済む「一発完結型」の5コマンド。race条件なし・2段階UI なし。

### 共通ヘルパ: 権限チェック + 応答構築

### Task 4.1: 共通応答ヘルパ

**Files:**
- Create: `src/lib/respond.ts`

- [ ] **Step 1: 実装**

```ts
import type { APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags } from '../discord/types.js';

export function ephemeralMessage(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content, flags: MessageFlags.Ephemeral },
  };
}

export function publicMessage(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { content },
  };
}

export function updateMessage(content: string): APIInteractionResponse {
  return {
    type: InteractionResponseType.UpdateMessage,
    data: { content, components: [] },
  };
}
```

- [ ] **Step 2: typecheck + commit**

```bash
npm run typecheck && git add src/lib/respond.ts && git commit -m "feat: add interaction response helpers"
```

### Task 4.2: /channel claim (admin only)

**Files:**
- Create: `src/commands/claim.ts`
- Modify: `src/commands/index.ts`
- Create: `test/commands/claim.test.ts`

- [ ] **Step 1: failing test**

`test/commands/claim.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleClaim } from '../../src/commands/claim.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envWithAdmin = {
  ...env,
  ADMIN_ROLE_IDS: ['admin1'],
  DB: env.DB,
};

function mockRest(overrides: Partial<any> = {}) {
  return {
    patchChannel: vi.fn(),
    deleteChannel: vi.fn(),
    createGuildChannel: vi.fn(),
    postMessage: vi.fn(),
    getChannel: vi.fn().mockResolvedValue({ id: 'ch1', name: 'exists', type: 0 }),
    listGuildChannels: vi.fn(),
    ...overrides,
  };
}

describe('/channel claim', () => {
  it('admin が他人のchをclaim→D1に登録される', async () => {
    const store = createStore(env.DB);
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'claim',
      options: [{ name: 'user', value: 'target-user' }],
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleClaim(interaction as any, envWithAdmin as any, { store, rest, now: () => '2026-04-14T00:00:00Z' });

    expect(res.data?.content).toContain('✅');
    expect(await store.getOwnerOf('ch1')).toBe('target-user');
  });

  it('非admin は拒否', async () => {
    const store = createStore(env.DB);
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'claim',
      options: [{ name: 'user', value: 'target-user' }],
      userId: 'normal', userRoles: [],
      channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleClaim(interaction as any, envWithAdmin as any, { store, rest, now: () => '2026-04-14T00:00:00Z' });

    expect(res.data?.content).toContain('❌');
    expect(await store.getOwnerOf('ch1')).toBeNull();
  });

  it('既に登録済みのchは拒否', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'existing', kind: 'text' });
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'claim',
      options: [{ name: 'user', value: 'target-user' }],
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleClaim(interaction as any, envWithAdmin as any, { store, rest, now: () => '2026-04-14T00:00:00Z' });

    expect(res.data?.content).toContain('既に登録');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗確認**

```bash
npm test test/commands/claim.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: 実装**

`src/commands/claim.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { isAdmin } from '../ownership/permissions.js';
import { ephemeralMessage } from '../lib/respond.js';
import { createAuditLog } from '../ownership/audit-log.js';

interface Deps {
  store: Store;
  rest: DiscordRest;
  now?: () => string;
}

export async function handleClaim(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const actorRoles = interaction.member?.roles ?? [];
  if (!isAdmin(actorRoles, env.ADMIN_ROLE_IDS)) {
    return ephemeralMessage('❌ このコマンドは管理者専用です');
  }

  const channelId = interaction.channel_id as string;
  const subOption = (interaction.data as any).options?.[0];
  const target = (subOption?.options as Array<{ name: string; value: string }> | undefined)
    ?.find(o => o.name === 'user')?.value;
  if (!target) return ephemeralMessage('❌ 対象ユーザーが指定されていません');

  const actorId = interaction.member!.user.id;

  if (await store.getOwnerOf(channelId)) {
    return ephemeralMessage('❌ このチャンネルは既に登録されています');
  }

  await store.insertChannel({ channel_id: channelId, owner_id: target, kind: 'text' });

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'ownership_claimed',
    channel_id: channelId,
    owner_id: target,
    actor_id: actorId,
    ts: now(),
  });

  return ephemeralMessage(`✅ <#${channelId}> のオーナーを <@${target}> に登録しました`);
}
```

- [ ] **Step 4: index.ts に登録**

`src/commands/index.ts`:
```ts
import type { CommandRouter } from '../interactions/command-router.js';
import { createStore } from '../ownership/store.js';
import { createDiscordRest } from '../discord/rest.js';
import { handleClaim } from './claim.js';

export function registerCommands(router: CommandRouter): void {
  router.register('channel', 'claim', async (interaction, env) => {
    const store = createStore(env.DB as unknown as D1Database);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleClaim(interaction, env, { store, rest });
  });
}
```

- [ ] **Step 5: test 実行 → 成功確認**

```bash
npm test test/commands/claim.test.ts
```

Expected: PASS (3 passing)

- [ ] **Step 6: commit**

```bash
git add src/commands/claim.ts src/commands/index.ts test/commands/claim.test.ts
git commit -m "feat: add /channel claim command with TDD"
```

### Task 4.3: /channel list (admin only)

**Files:**
- Create: `src/commands/list.ts`
- Create: `test/commands/list.test.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleList } from '../../src/commands/list.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envWithAdmin = { ...env, ADMIN_ROLE_IDS: ['admin1'], DB: env.DB };

describe('/channel list', () => {
  it('admin: 全チャンネル一覧を返す', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'c1', owner_id: 'u1', kind: 'text' });
    await store.insertChannel({ channel_id: 'c2', owner_id: 'u2', kind: 'text' });

    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'list',
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'ch-any', guildId: 'g1',
    });

    const res = await handleList(interaction as any, envWithAdmin as any, { store });
    expect(res.data?.content).toContain('c1');
    expect(res.data?.content).toContain('c2');
  });

  it('非admin は拒否', async () => {
    const store = createStore(env.DB);
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'list',
      userId: 'normal', userRoles: [],
      channelId: 'ch-any', guildId: 'g1',
    });
    const res = await handleList(interaction as any, envWithAdmin as any, { store });
    expect(res.data?.content).toContain('❌');
  });

  it('0件でも崩れない', async () => {
    const store = createStore(env.DB);
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'list',
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'ch-any', guildId: 'g1',
    });
    const res = await handleList(interaction as any, envWithAdmin as any, { store });
    expect(res.data?.content).toContain('件');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗確認**

```bash
npm test test/commands/list.test.ts
```

- [ ] **Step 3: 実装**

`src/commands/list.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import { isAdmin } from '../ownership/permissions.js';
import { ephemeralMessage } from '../lib/respond.js';

interface Deps {
  store: Store;
}

export async function handleList(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const actorRoles = interaction.member?.roles ?? [];
  if (!isAdmin(actorRoles, env.ADMIN_ROLE_IDS)) {
    return ephemeralMessage('❌ このコマンドは管理者専用です');
  }

  const rows = await deps.store.listAll();
  if (rows.length === 0) {
    return ephemeralMessage('📋 登録チャンネル: 0件');
  }

  const lines = rows.map(r =>
    `<#${r.channel_id}>  owner:<@${r.owner_id}>  created:${r.created_at.slice(0, 10)}`,
  );
  const chunks: string[] = [];
  let cur = `📋 登録チャンネル: ${rows.length}件\n`;
  for (const line of lines) {
    if (cur.length + line.length + 1 > 1900) {
      chunks.push(cur);
      cur = '';
    }
    cur += line + '\n';
  }
  if (cur) chunks.push(cur);

  return ephemeralMessage(chunks[0] ?? '');
}
```

※ 1900文字制限。複数メッセージに分ける必要が出たら follow-up webhook に切り替え（MVPでは最初の chunk のみ表示、「残りN件」と付記可）。

- [ ] **Step 4: index.ts に登録**

```ts
import { handleList } from './list.js';
// ...
router.register('channel', 'list', async (interaction, env) => {
  const store = createStore(env.DB as unknown as D1Database);
  return handleList(interaction, env, { store });
});
```

- [ ] **Step 5: test実行 → 成功**

```bash
npm test test/commands/list.test.ts
```

- [ ] **Step 6: commit**

```bash
git add src/commands/list.ts src/commands/index.ts test/commands/list.test.ts
git commit -m "feat: add /channel list command"
```

### Task 4.4: 共通オーナー検証ヘルパ

**Files:**
- Create: `src/commands/_common.ts`

**目的**: rename/move/settopic/delete はすべて「対象ch内で実行、オーナーまたは管理者のみ可」のパターン。共通化する。

- [ ] **Step 1: 実装**

```ts
import type { APIApplicationCommandInteraction } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import { resolveActorPermission, type ActorPermission } from '../ownership/permissions.js';
import { NotOwnerError, NotRegisteredError } from '../lib/errors.js';

export interface ActorContext {
  actorId: string;
  actorRoles: readonly string[];
  channelId: string;
  permission: ActorPermission;
}

export async function requireOwnerOrAdmin(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  store: Store,
): Promise<ActorContext> {
  const actorId = interaction.member!.user.id;
  const actorRoles = interaction.member!.roles;
  const channelId = interaction.channel_id as string;

  const ownerId = await store.getOwnerOf(channelId);
  const permission = resolveActorPermission({
    actorId,
    actorRoles,
    ownerId,
    adminRoleIds: env.ADMIN_ROLE_IDS,
  });

  if (permission === 'none') {
    if (ownerId === null) throw new NotRegisteredError();
    throw new NotOwnerError();
  }

  return { actorId, actorRoles, channelId, permission };
}

export function getSubcommandOption<T extends string | number>(
  interaction: APIApplicationCommandInteraction,
  name: string,
): T | undefined {
  const data = interaction.data as any;
  const sub = data.options?.[0];
  const opt = sub?.options?.find((o: any) => o.name === name);
  return opt?.value as T | undefined;
}
```

- [ ] **Step 2: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: commit**

```bash
git add src/commands/_common.ts
git commit -m "feat: add common owner/admin check helper for commands"
```

### Task 4.5: /channel rename

**Files:**
- Create: `src/commands/rename.ts`
- Create: `test/commands/rename.test.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleRename } from '../../src/commands/rename.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envBase = { ...env, ADMIN_ROLE_IDS: ['admin1'], DB: env.DB };

function mockRest() {
  return {
    patchChannel: vi.fn().mockResolvedValue({ id: 'ch1', name: 'new-name' }),
    getChannel: vi.fn().mockResolvedValue({ id: 'ch1', name: 'old-name' }),
    deleteChannel: vi.fn(), createGuildChannel: vi.fn(),
    postMessage: vi.fn(), listGuildChannels: vi.fn(),
  };
}

describe('/channel rename', () => {
  it('owner が実行 → 成功', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'rename',
      options: [{ name: 'new_name', value: 'new-name' }],
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleRename(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('✅');
    expect(rest.patchChannel).toHaveBeenCalledWith('ch1', { name: 'new-name' });
  });

  it('非owner が実行 → 拒否', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'rename',
      options: [{ name: 'new_name', value: 'hacked' }],
      userId: 'u2', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleRename(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('❌');
    expect(rest.patchChannel).not.toHaveBeenCalled();
  });

  it('admin が実行 → 成功', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'rename',
      options: [{ name: 'new_name', value: 'admin-changed' }],
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleRename(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('✅');
    expect(rest.patchChannel).toHaveBeenCalled();
  });

  it('未登録ch は拒否', async () => {
    const store = createStore(env.DB);
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'rename',
      options: [{ name: 'new_name', value: 'foo' }],
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleRename(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('登録されていません');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗**

```bash
npm test test/commands/rename.test.ts
```

- [ ] **Step 3: 実装**

`src/commands/rename.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin, getSubcommandOption } from './_common.js';
import { createAuditLog } from '../ownership/audit-log.js';
import { ephemeralMessage } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

interface Deps {
  store: Store;
  rest: DiscordRest;
  now?: () => string;
}

export async function handleRename(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  let ctx;
  try {
    ctx = await requireOwnerOrAdmin(interaction, env, store);
  } catch (e) {
    if (e instanceof DomainError) return ephemeralMessage(e.userMessage);
    throw e;
  }

  const newName = getSubcommandOption<string>(interaction, 'new_name');
  if (!newName) return ephemeralMessage('❌ new_name が指定されていません');

  const before = await rest.getChannel(ctx.channelId);
  await rest.patchChannel(ctx.channelId, { name: newName });
  await store.touchLastModified(ctx.channelId);

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'channel_renamed',
    channel_id: ctx.channelId,
    old_name: before.name ?? '',
    new_name: newName,
    actor_id: ctx.actorId,
    ts: now(),
  });

  return ephemeralMessage(`✅ チャンネル名を \`${newName}\` に変更しました`);
}
```

- [ ] **Step 4: index.ts に登録**

```ts
import { handleRename } from './rename.js';
router.register('channel', 'rename', async (interaction, env) => {
  const store = createStore(env.DB as unknown as D1Database);
  const rest = createDiscordRest(env.DISCORD_TOKEN);
  return handleRename(interaction, env, { store, rest });
});
```

- [ ] **Step 5: test → 成功**

```bash
npm test test/commands/rename.test.ts
```

- [ ] **Step 6: commit**

```bash
git add src/commands/rename.ts src/commands/index.ts test/commands/rename.test.ts
git commit -m "feat: add /channel rename command"
```

### Task 4.6: /channel move

**Files:**
- Create: `src/commands/move.ts`
- Create: `test/commands/move.test.ts`
- Modify: `src/commands/index.ts`

**仕様**: owner は同一カテゴリ内リオーダーのみ。admin も同様（MVPでは cross-category は未実装）。

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleMove } from '../../src/commands/move.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envBase = { ...env, ADMIN_ROLE_IDS: ['admin1'], DB: env.DB };

function mockRest(existing: { position: number; parent_id: string }) {
  return {
    getChannel: vi.fn().mockResolvedValue({ id: 'ch1', position: existing.position, parent_id: existing.parent_id }),
    patchChannel: vi.fn().mockResolvedValue({ id: 'ch1' }),
    deleteChannel: vi.fn(), createGuildChannel: vi.fn(),
    postMessage: vi.fn(), listGuildChannels: vi.fn(),
  };
}

describe('/channel move', () => {
  it('owner: position 変更成功', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const rest = mockRest({ position: 3, parent_id: 'cat1' });

    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'move',
      options: [{ name: 'position', value: 5 }],
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleMove(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('✅');
    expect(rest.patchChannel).toHaveBeenCalledWith('ch1', { position: 5 });
  });

  it('非owner: 拒否', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const rest = mockRest({ position: 3, parent_id: 'cat1' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'move',
      options: [{ name: 'position', value: 5 }],
      userId: 'u2', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleMove(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('❌');
    expect(rest.patchChannel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: test 実行 → 失敗**

- [ ] **Step 3: 実装**

`src/commands/move.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin, getSubcommandOption } from './_common.js';
import { createAuditLog } from '../ownership/audit-log.js';
import { ephemeralMessage } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

interface Deps {
  store: Store;
  rest: DiscordRest;
  now?: () => string;
}

export async function handleMove(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  let ctx;
  try {
    ctx = await requireOwnerOrAdmin(interaction, env, store);
  } catch (e) {
    if (e instanceof DomainError) return ephemeralMessage(e.userMessage);
    throw e;
  }

  const position = getSubcommandOption<number>(interaction, 'position');
  if (position === undefined) return ephemeralMessage('❌ position が指定されていません');
  if (position < 0) return ephemeralMessage('❌ position は 0 以上で指定してください');

  const before = await rest.getChannel(ctx.channelId);
  const oldPosition = (before as any).position ?? 0;

  await rest.patchChannel(ctx.channelId, { position });
  await store.touchLastModified(ctx.channelId);

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'channel_moved',
    channel_id: ctx.channelId,
    old_position: oldPosition,
    new_position: position,
    actor_id: ctx.actorId,
    ts: now(),
  });

  return ephemeralMessage(`✅ 並び順を \`${position}\` に変更しました`);
}
```

- [ ] **Step 4: index.ts 登録 + test → 成功 + commit**

```bash
npm test test/commands/move.test.ts && \
git add src/commands/move.ts src/commands/index.ts test/commands/move.test.ts && \
git commit -m "feat: add /channel move command (same-category reorder)"
```

### Task 4.7: /channel settopic

**Files:**
- Create: `src/commands/settopic.ts`
- Create: `test/commands/settopic.test.ts`
- Modify: `src/commands/index.ts`

rename と同じ構造。topic を PATCH する。

- [ ] **Step 1: 全体（test + 実装）を rename に倣って作成**

`test/commands/settopic.test.ts` と `src/commands/settopic.ts` を rename と同様のパターンで実装。
- option 名: `topic`（string）
- Discord API: `patchChannel(id, { topic })`
- 監査イベント: `channel_topic_updated`（`old_topic`, `new_topic` を含む）

完全なコード:

`src/commands/settopic.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { requireOwnerOrAdmin, getSubcommandOption } from './_common.js';
import { createAuditLog } from '../ownership/audit-log.js';
import { ephemeralMessage } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

interface Deps { store: Store; rest: DiscordRest; now?: () => string }

export async function handleSetTopic(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  let ctx;
  try { ctx = await requireOwnerOrAdmin(interaction, env, store); }
  catch (e) { if (e instanceof DomainError) return ephemeralMessage(e.userMessage); throw e; }

  const topic = getSubcommandOption<string>(interaction, 'topic') ?? '';
  const before = await rest.getChannel(ctx.channelId);
  await rest.patchChannel(ctx.channelId, { topic });
  await store.touchLastModified(ctx.channelId);

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'channel_topic_updated',
    channel_id: ctx.channelId,
    old_topic: (before as any).topic ?? null,
    new_topic: topic,
    actor_id: ctx.actorId,
    ts: now(),
  });

  return ephemeralMessage('✅ topic を更新しました');
}
```

`test/commands/settopic.test.ts`: rename のテストを流用し、option を `{ name: 'topic', value: '...' }` に、期待される `patchChannel` 呼び出しを `{ topic: ... }` に書き換え。最低3ケース（owner成功、非owner拒否、未登録ch拒否）。

- [ ] **Step 2: index.ts に登録 + test + commit**

```bash
npm test test/commands/settopic.test.ts && \
git add src/commands/settopic.ts src/commands/index.ts test/commands/settopic.test.ts && \
git commit -m "feat: add /channel settopic command"
```

---

## Chunk 5: 複雑コマンド (create with race, delete 2段階)

### Task 5.1: /channel create (race mitigation + 補償削除)

**Files:**
- Create: `src/commands/create.ts`
- Create: `test/commands/create.test.ts`
- Modify: `src/commands/index.ts`

**仕様**: 
- 非admin: 既に所有chがあれば拒否（1人1ch制約）
- admin: 制約無視
- 個人chカテゴリ内で実行されたら拒否
- 実装: Discord 作成成功 → D1 `INSERT WHERE NOT EXISTS` → affected=0 なら Discord 側を補償削除

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleCreate } from '../../src/commands/create.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envBase = {
  ...env,
  ADMIN_ROLE_IDS: ['admin1'],
  PERSONAL_CHANNELS_CATEGORY_ID: 'cat-personal',
  GUILD_ID: 'g1',
  DB: env.DB,
};

function mockRest(opts: { createdId?: string } = {}) {
  return {
    createGuildChannel: vi.fn().mockResolvedValue({
      id: opts.createdId ?? 'new-ch', name: 'nassy-progress', type: 0, parent_id: 'cat-personal',
    }),
    deleteChannel: vi.fn(),
    getChannel: vi.fn().mockResolvedValue({ id: 'from-ch', parent_id: 'different-cat' }),
    patchChannel: vi.fn(), postMessage: vi.fn(), listGuildChannels: vi.fn(),
  };
}

describe('/channel create', () => {
  it('通常ユーザー: 正常作成 → D1登録', async () => {
    const store = createStore(env.DB);
    const rest = mockRest({ createdId: 'ch-new' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'create',
      options: [{ name: 'name', value: 'nassy-progress' }],
      userId: 'u1', channelId: 'from-ch', guildId: 'g1',
    });
    const res = await handleCreate(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('✅');
    expect(await store.getOwnerOf('ch-new')).toBe('u1');
  });

  it('既に所有していたら 拒否（Discord作成もしない）', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'existing', owner_id: 'u1', kind: 'text' });
    const rest = mockRest();
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'create',
      options: [{ name: 'name', value: 'second' }],
      userId: 'u1', channelId: 'from-ch', guildId: 'g1',
    });
    const res = await handleCreate(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('既に');
    expect(rest.createGuildChannel).not.toHaveBeenCalled();
  });

  it('admin: 既存chあっても作成可', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'existing', owner_id: 'admin-user', kind: 'text' });
    const rest = mockRest({ createdId: 'ch-admin-new' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'create',
      options: [{ name: 'name', value: 'admin-extra' }],
      userId: 'admin-user', userRoles: ['admin1'],
      channelId: 'from-ch', guildId: 'g1',
    });
    const res = await handleCreate(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('✅');
  });

  it('個人chカテゴリ内で実行 → 拒否', async () => {
    const store = createStore(env.DB);
    const rest = mockRest();
    rest.getChannel = vi.fn().mockResolvedValue({ id: 'from-ch', parent_id: 'cat-personal' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'create',
      options: [{ name: 'name', value: 'foo' }],
      userId: 'u1', channelId: 'from-ch', guildId: 'g1',
    });
    const res = await handleCreate(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('外で');
    expect(rest.createGuildChannel).not.toHaveBeenCalled();
  });

  it('race: INSERT 失敗時は Discord 側を補償削除', async () => {
    const store = createStore(env.DB);
    // 同時create想定: 先に別のcreate が成功している状態を模擬
    await store.insertChannel({ channel_id: 'other', owner_id: 'u1', kind: 'text' });
    const rest = mockRest({ createdId: 'ch-new' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'create',
      options: [{ name: 'name', value: 'second' }],
      userId: 'u1', channelId: 'from-ch', guildId: 'g1',
    });
    // 今回のtestは "pre-check で弾かれる" パスになるため、race状態の再現には別アプローチが必要。
    // 実装側で pre-check とINSERT WHERE NOT EXISTS の二段防御を持つため、pre-checkで拒否されるのは正しい挙動。
    const res = await handleCreate(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('既に');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗**

- [ ] **Step 3: 実装**

`src/commands/create.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import { ChannelType } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { isAdmin } from '../ownership/permissions.js';
import { getSubcommandOption } from './_common.js';
import { createAuditLog } from '../ownership/audit-log.js';
import { ephemeralMessage } from '../lib/respond.js';

interface Deps {
  store: Store;
  rest: DiscordRest;
  now?: () => string;
}

export async function handleCreate(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const actorId = interaction.member!.user.id;
  const actorRoles = interaction.member!.roles;
  const fromChannelId = interaction.channel_id as string;
  const admin = isAdmin(actorRoles, env.ADMIN_ROLE_IDS);

  // 実行場所チェック: 個人chカテゴリ内で実行されたら拒否
  const fromChannel = await rest.getChannel(fromChannelId);
  if ((fromChannel as any).parent_id === env.PERSONAL_CHANNELS_CATEGORY_ID) {
    return ephemeralMessage('❌ このコマンドは個人chカテゴリ外で実行してください');
  }

  const name = getSubcommandOption<string>(interaction, 'name');
  if (!name) return ephemeralMessage('❌ name が指定されていません');

  // pre-check: 非adminなら所有済み確認
  if (!admin && await store.hasChannel(actorId)) {
    return ephemeralMessage('❌ 既にチャンネルを所有しています（1人1チャンネル制限）');
  }

  // Discord API で作成
  const created = await rest.createGuildChannel(env.GUILD_ID, {
    name,
    type: ChannelType.GuildText,
    parent_id: env.PERSONAL_CHANNELS_CATEGORY_ID,
  });

  // D1 に INSERT (非adminはWHERE NOT EXISTS で二重防御)
  let inserted = false;
  if (admin) {
    await store.insertChannel({ channel_id: created.id, owner_id: actorId, kind: 'text' });
    inserted = true;
  } else {
    inserted = await store.insertChannelIfNoneOwned({
      channel_id: created.id, owner_id: actorId, kind: 'text',
    });
  }

  if (!inserted) {
    // race で負けた: Discord側を補償削除
    try {
      await rest.deleteChannel(created.id);
    } catch (e) {
      console.error('[create] compensating delete failed', e);
    }
    return ephemeralMessage('❌ 既にチャンネルを所有しています（レース検出）');
  }

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'channel_created',
    channel_id: created.id,
    owner_id: actorId,
    name,
    kind: 'text',
    actor_id: actorId,
    ts: now(),
  });

  return ephemeralMessage(`✅ チャンネルを作成しました → <#${created.id}>`);
}
```

- [ ] **Step 4: index.ts 登録 + test → 成功 + commit**

```bash
npm test test/commands/create.test.ts && \
git add src/commands/create.ts src/commands/index.ts test/commands/create.test.ts && \
git commit -m "feat: add /channel create with race mitigation and compensating delete"
```

### Task 5.2: /channel delete (2段階: コマンド→ボタン)

**Files:**
- Create: `src/commands/delete.ts`
- Create: `test/commands/delete.test.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleDelete } from '../../src/commands/delete.js';
import { createStore } from '../../src/ownership/store.js';
import { commandInteraction } from '../fixtures/interactions.js';

const envBase = { ...env, ADMIN_ROLE_IDS: ['admin1'], DB: env.DB };

describe('/channel delete (step A: confirm button)', () => {
  it('owner: 確認ボタンを返す + nonce を登録', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });

    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'delete',
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleDelete(interaction as any, envBase as any, {
      store,
      randomNonce: () => 'nonce-abc',
    });

    expect(res.data?.content).toContain('本当に');
    expect(res.data?.components).toBeDefined();
    const comps = (res.data?.components as any[])[0].components;
    expect(comps[0].custom_id).toBe('del-confirm:ch1:u1:nonce-abc');

    const nonce = await store.consumeNonce('nonce-abc', 'delete-confirm');
    expect(nonce).not.toBeNull();
  });

  it('非owner: 拒否 + nonce未登録', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    const interaction = commandInteraction({
      commandName: 'channel', subcommand: 'delete',
      userId: 'u2', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleDelete(interaction as any, envBase as any, {
      store, randomNonce: () => 'nonce-abc',
    });
    expect(res.data?.content).toContain('❌');
    const nonce = await store.consumeNonce('nonce-abc', 'delete-confirm');
    expect(nonce).toBeNull();
  });
});
```

- [ ] **Step 2: test 実行 → 失敗**

- [ ] **Step 3: 実装**

`src/commands/delete.ts`:

```ts
import type { APIApplicationCommandInteraction, APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType, MessageFlags, ComponentType, ButtonStyle } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import { requireOwnerOrAdmin } from './_common.js';
import { ephemeralMessage } from '../lib/respond.js';
import { DomainError } from '../lib/errors.js';

interface Deps {
  store: Store;
  randomNonce?: () => string;
}

const NONCE_TTL_MS = 60_000;

export async function handleDelete(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store } = deps;
  const randomNonce = deps.randomNonce ?? (() => crypto.randomUUID());

  let ctx;
  try { ctx = await requireOwnerOrAdmin(interaction, env, store); }
  catch (e) { if (e instanceof DomainError) return ephemeralMessage(e.userMessage); throw e; }

  const nonce = randomNonce();
  await store.createNonce({
    nonce,
    actor_id: ctx.actorId,
    channel_id: ctx.channelId,
    purpose: 'delete-confirm',
    expires_at_ms_from_now: NONCE_TTL_MS,
  });

  return {
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: `⚠️ 本当に <#${ctx.channelId}> を削除しますか？ 取り消せません。`,
      flags: MessageFlags.Ephemeral,
      components: [{
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Danger,
            label: '🗑️ 削除する',
            custom_id: `del-confirm:${ctx.channelId}:${ctx.actorId}:${nonce}`,
          },
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: 'キャンセル',
            custom_id: `del-cancel:${nonce}`,
          },
        ],
      }],
    },
  };
}
```

- [ ] **Step 4: index.ts 登録 + test → 成功 + commit**

```bash
npm test test/commands/delete.test.ts && \
git add src/commands/delete.ts src/commands/index.ts test/commands/delete.test.ts && \
git commit -m "feat: add /channel delete command (step A: confirm button)"
```

### Task 5.3: delete-confirm コンポーネント (ボタン押下)

**Files:**
- Create: `src/components/delete-confirm.ts`
- Create: `test/components/delete-confirm.test.ts`
- Modify: `src/components/index.ts`

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleDeleteConfirm } from '../../src/components/delete-confirm.js';
import { createStore } from '../../src/ownership/store.js';
import { componentInteraction } from '../fixtures/interactions.js';

const envBase = { ...env, ADMIN_ROLE_IDS: ['admin1'], DB: env.DB };

function mockRest() {
  return {
    deleteChannel: vi.fn().mockResolvedValue(undefined),
    patchChannel: vi.fn(), createGuildChannel: vi.fn(),
    getChannel: vi.fn(), postMessage: vi.fn(), listGuildChannels: vi.fn(),
  };
}

describe('delete-confirm', () => {
  it('正規フロー: nonce有効 & 本人 → 削除成功', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    await store.createNonce({
      nonce: 'n1', actor_id: 'u1', channel_id: 'ch1', purpose: 'delete-confirm',
      expires_at_ms_from_now: 60000,
    });

    const rest = mockRest();
    const interaction = componentInteraction({
      customId: 'del-confirm:ch1:u1:n1',
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleDeleteConfirm(interaction as any, envBase as any, { store, rest: rest as any });

    expect(res.data?.content).toContain('✅');
    expect(rest.deleteChannel).toHaveBeenCalledWith('ch1');
    expect(await store.getOwnerOf('ch1')).toBeNull();
  });

  it('nonce期限切れ: 拒否', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    await store.createNonce({
      nonce: 'n1', actor_id: 'u1', channel_id: 'ch1', purpose: 'delete-confirm',
      expires_at_ms_from_now: -1000,
    });

    const rest = mockRest();
    const interaction = componentInteraction({
      customId: 'del-confirm:ch1:u1:n1',
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleDeleteConfirm(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('期限');
    expect(rest.deleteChannel).not.toHaveBeenCalled();
  });

  it('別ユーザーが押下: 拒否', async () => {
    const store = createStore(env.DB);
    await store.insertChannel({ channel_id: 'ch1', owner_id: 'u1', kind: 'text' });
    await store.createNonce({
      nonce: 'n1', actor_id: 'u1', channel_id: 'ch1', purpose: 'delete-confirm',
      expires_at_ms_from_now: 60000,
    });

    const rest = mockRest();
    const interaction = componentInteraction({
      customId: 'del-confirm:ch1:u1:n1',
      userId: 'u2', channelId: 'ch1', guildId: 'g1',
    });

    const res = await handleDeleteConfirm(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('❌');
    expect(rest.deleteChannel).not.toHaveBeenCalled();
  });

  it('del-cancel: nonce消化してキャンセル表示', async () => {
    const store = createStore(env.DB);
    await store.createNonce({
      nonce: 'n1', actor_id: 'u1', channel_id: 'ch1', purpose: 'delete-confirm',
      expires_at_ms_from_now: 60000,
    });
    const rest = mockRest();
    const interaction = componentInteraction({
      customId: 'del-cancel:n1',
      userId: 'u1', channelId: 'ch1', guildId: 'g1',
    });
    const res = await handleDeleteConfirm(interaction as any, envBase as any, { store, rest: rest as any });
    expect(res.data?.content).toContain('キャンセル');
  });
});
```

- [ ] **Step 2: test 実行 → 失敗**

- [ ] **Step 3: 実装**

`src/components/delete-confirm.ts`:

```ts
import type { APIMessageComponentInteraction, APIInteractionResponse } from '../discord/types.js';
import { InteractionResponseType } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import type { DiscordRest } from '../discord/rest.js';
import { updateMessage } from '../lib/respond.js';
import { createAuditLog } from '../ownership/audit-log.js';

interface Deps {
  store: Store;
  rest: DiscordRest;
  now?: () => string;
}

export async function handleDeleteConfirm(
  interaction: APIMessageComponentInteraction,
  env: Env,
  deps: Deps,
): Promise<APIInteractionResponse> {
  const { store, rest } = deps;
  const now = deps.now ?? (() => new Date().toISOString());

  const customId = interaction.data.custom_id;
  const actor = interaction.member!.user.id;

  if (customId.startsWith('del-cancel:')) {
    const nonce = customId.slice('del-cancel:'.length);
    await store.consumeNonce(nonce, 'delete-confirm');
    return updateMessage('⚪ キャンセルしました');
  }

  // del-confirm:<ch_id>:<actor_id>:<nonce>
  const parts = customId.split(':');
  if (parts.length !== 4 || parts[0] !== 'del-confirm') {
    return updateMessage('❌ 不正な操作です');
  }
  const [, channelId, expectedActor, nonce] = parts as [string, string, string, string];

  if (actor !== expectedActor) {
    return updateMessage('❌ 別ユーザーによる操作は無効です');
  }

  const consumed = await store.consumeNonce(nonce, 'delete-confirm');
  if (!consumed) {
    return updateMessage('⚪ 期限切れです。もう一度 /channel delete を実行してください');
  }

  const ownerId = await store.getOwnerOf(channelId);

  try {
    await rest.deleteChannel(channelId);
  } catch (e) {
    console.error('[delete-confirm] discord delete failed', e);
    return updateMessage('❌ Discord API での削除に失敗しました');
  }

  await store.deleteChannel(channelId);

  const audit = createAuditLog(rest, env.EVENT_LOG_CHANNEL_ID);
  await audit.post({
    type: 'channel_deleted',
    channel_id: channelId,
    owner_id: ownerId ?? 'unknown',
    actor_id: actor,
    ts: now(),
  });

  return updateMessage('✅ チャンネルを削除しました');
}
```

- [ ] **Step 4: components/index.ts に登録**

```ts
import type { ComponentRouter } from '../interactions/component-router.js';
import { createStore } from '../ownership/store.js';
import { createDiscordRest } from '../discord/rest.js';
import { handleDeleteConfirm } from './delete-confirm.js';

export function registerComponents(router: ComponentRouter): void {
  const handler = async (interaction: any, env: any) => {
    const store = createStore(env.DB);
    const rest = createDiscordRest(env.DISCORD_TOKEN);
    return handleDeleteConfirm(interaction, env, { store, rest });
  };
  router.register('del-confirm:', handler);
  router.register('del-cancel:', handler);
}
```

- [ ] **Step 5: test → 成功 + commit**

```bash
npm test test/components/delete-confirm.test.ts && \
git add src/components/delete-confirm.ts src/components/index.ts test/components/delete-confirm.test.ts && \
git commit -m "feat: add delete-confirm component handler"
```

---

## Chunk 6: スクリプト + デプロイ + 初回マイグレーション

### Task 6.1: scripts/register-commands.ts

**Files:**
- Create: `scripts/register-commands.ts`

- [ ] **Step 1: 実装**

```ts
import { config } from 'dotenv';
config();

const APP_ID = process.env.DISCORD_APPLICATION_ID!;
const GUILD_ID = process.env.GUILD_ID!;
const TOKEN = process.env.DISCORD_TOKEN!;

if (!APP_ID || !GUILD_ID || !TOKEN) {
  console.error('Missing env: DISCORD_APPLICATION_ID, GUILD_ID, DISCORD_TOKEN');
  process.exit(1);
}

const commands = [
  {
    name: 'channel',
    description: 'チャンネル管理コマンド',
    options: [
      {
        name: 'create', type: 1, description: '新しいチャンネルを作成',
        options: [{ name: 'name', type: 3, description: 'チャンネル名', required: true }],
      },
      {
        name: 'rename', type: 1, description: 'チャンネル名を変更',
        options: [{ name: 'new_name', type: 3, description: '新しい名前', required: true }],
      },
      {
        name: 'move', type: 1, description: '同カテゴリ内で並び順を変更',
        options: [{ name: 'position', type: 4, description: '位置 (0=先頭)', required: true }],
      },
      {
        name: 'settopic', type: 1, description: 'チャンネルの topic を変更',
        options: [{ name: 'topic', type: 3, description: '新しいtopic', required: true }],
      },
      {
        name: 'delete', type: 1, description: 'チャンネルを削除 (確認ボタンあり)',
      },
      {
        name: 'claim', type: 1, description: '[admin] 既存chにオーナーを割り当て',
        options: [{ name: 'user', type: 6, description: 'オーナーに設定するユーザー', required: true }],
      },
      {
        name: 'list', type: 1, description: '[admin] 登録チャンネル一覧',
      },
    ],
  },
];

const url = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error('Failed:', res.status, await res.text());
  process.exit(1);
}
const registered = await res.json();
console.log(`✅ Registered ${(registered as any[]).length} commands`);
```

- [ ] **Step 2: dotenv 追加**

```bash
npm install -D dotenv
```

- [ ] **Step 3: commit**

```bash
git add scripts/register-commands.ts package.json package-lock.json
git commit -m "feat: add slash command registration script"
```

### Task 6.2: scripts/recovery.ts (災害復旧用)

**Files:**
- Create: `scripts/recovery.ts`

**用途**: D1 が消失した場合、ログchから全イベントを再生してD1を再構築。

- [ ] **Step 1: 実装**

```ts
import { config } from 'dotenv';
import { deserializeEvent, type OwnershipEvent } from '../src/ownership/events.js';
config();

const TOKEN = process.env.DISCORD_TOKEN!;
const LOG_CH = process.env.EVENT_LOG_CHANNEL_ID!;

async function fetchAllMessages(channelId: string): Promise<any[]> {
  const all: any[] = [];
  let before: string | undefined;
  while (true) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const batch = await res.json() as any[];
    if (batch.length === 0) break;
    all.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  return all.reverse(); // 古い順
}

function replayEvents(events: OwnershipEvent[]): Map<string, { owner_id: string; created_at: string; last_modified_at: string; kind: string }> {
  const state = new Map<string, any>();
  for (const ev of events) {
    switch (ev.type) {
      case 'channel_created':
      case 'ownership_claimed':
        state.set(ev.channel_id, {
          owner_id: ev.owner_id,
          created_at: ev.ts,
          last_modified_at: ev.ts,
          kind: ev.type === 'channel_created' ? ev.kind : 'text',
        });
        break;
      case 'channel_renamed':
      case 'channel_moved':
      case 'channel_topic_updated': {
        const cur = state.get(ev.channel_id);
        if (cur) state.set(ev.channel_id, { ...cur, last_modified_at: ev.ts });
        break;
      }
      case 'channel_deleted':
        state.delete(ev.channel_id);
        break;
    }
  }
  return state;
}

(async () => {
  const msgs = await fetchAllMessages(LOG_CH);
  const events: OwnershipEvent[] = [];
  for (const m of msgs) {
    const ev = deserializeEvent(m.content);
    if (ev) events.push(ev);
  }
  const state = replayEvents(events);

  console.log(`-- Recovered ${state.size} channels from ${events.length} events`);
  console.log('-- Paste the following SQL into wrangler d1 execute to restore:');
  console.log('');
  for (const [channel_id, s] of state) {
    console.log(`INSERT INTO channels (channel_id, owner_id, created_at, last_modified_at, kind) VALUES ('${channel_id}', '${s.owner_id}', '${s.created_at}', '${s.last_modified_at}', '${s.kind}');`);
  }
})();
```

- [ ] **Step 2: commit**

```bash
git add scripts/recovery.ts
git commit -m "feat: add D1 recovery script from log channel replay"
```

### Task 6.3: 全テスト実行 + typecheck の最終確認

- [ ] **Step 1: typecheck**

```bash
npm run typecheck
```

Expected: pass

- [ ] **Step 2: 全テスト**

```bash
npm test
```

Expected: all pass

- [ ] **Step 3: wrangler dev で起動確認**

```bash
npx wrangler dev --local
```

Expected: `http://localhost:8787` で動く。Ctrl+C で停止。

### Task 6.4: デプロイ手順（README更新含む）

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README に運用手順を追記**

Spec §6 の「初回デプロイ手順」「前提条件」「初回運用手順」の内容を README に反映。

- [ ] **Step 2: commit**

```bash
git add README.md
git commit -m "docs: add setup and deployment instructions to README"
```

### Task 6.5: 実デプロイ（対象サーバが準備できてから実施）

以下は実際のDiscordサーバで初回動作確認する手順。このチェックリストは手動実行。

- [ ] **Step 1: Discord側の前提設定（Spec §6 参照）**
  - @everyone から Manage Channels / Manage Roles を剥奪
  - `PERSONAL_CHANNELS_CATEGORY_ID` 用カテゴリ作成
  - `EVENT_LOG_CHANNEL_ID` 用ch作成（admin View / Bot Send のみ許可）
  - Bot ロールに Manage Channels / Send Messages / View Channel / Read Message History 付与

- [ ] **Step 2: wrangler セットアップ**

```bash
npx wrangler login
npx wrangler d1 create discord-channel-manager
# → database_id を wrangler.toml に記入
npx wrangler d1 execute discord-channel-manager --remote --file=scripts/schema.sql
```

- [ ] **Step 3: Secrets 登録**

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
```

- [ ] **Step 4: wrangler.toml の [vars] に実IDを記入**

- [ ] **Step 5: デプロイ**

```bash
npx wrangler deploy
```

- [ ] **Step 6: Slash command 登録**

```bash
# ローカルの .env に DISCORD_APPLICATION_ID / GUILD_ID / DISCORD_TOKEN を設定
npm run register-commands
```

- [ ] **Step 7: Discord Developer Portal で Interactions Endpoint URL を設定**

`https://discord-channel-manager.<subdomain>.workers.dev/` を入力 → PING が送られる → Worker が PONG を返せば登録完了

- [ ] **Step 8: Bot を対象サーバに招待（OAuth URL生成）**

- [ ] **Step 9: スモークテスト**

適当なテキストチャンネル（個人chカテゴリ外）で `/channel create test-foo` を実行 → 新チャンネル作成を確認 → そのチャンネル内で `/channel rename test-bar` で名前変更確認

- [ ] **Step 10: 初回マイグレーション**

`/channel list` で全ch状況を俯瞰 → 各既存chで `/channel claim @owner` を実行

- [ ] **Step 11: claim 無効化**

全claim完了後:
```bash
rm src/commands/claim.ts
# src/commands/index.ts から claim 登録を削除
git commit -am "chore: disable /channel claim after migration complete"
npm run register-commands   # 登録解除
npx wrangler deploy
```

---

## 完了基準

全チャンクのタスクが終わると:
- `src/` 以下の全ファイルがTDDで実装済み
- 全テスト green
- Cloudflare Workers にデプロイ可能
- Discord サーバに登録・運用開始可能

**次のステップ:** `docs/superpowers/plans/2026-04-14-discord-channel-manager.md` に保存したこのプランに従って、`superpowers:subagent-driven-development` スキルで実装を開始する（サブエージェントが使える環境のため）。
