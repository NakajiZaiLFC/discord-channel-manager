# Discord Channel Manager — 設計書

## これはなに

- 非管理者が他人のDiscordチャンネルを勝手に編集/削除できないようにしつつ、**「自分のチャンネル」は本人が編集できる状態**を取り戻すための Discord 管理Bot
- すべての編集操作は Bot の Slash Command 経由で行い、Bot がオーナー検証を挟む（編集ルートを一本化して統制を効かせる）
- **Cloudflare Workers + D1** で恒久無料・ゼロ運用・クレカ不要で稼働

---

## 1. 背景と目的

対象Discordサーバでは現在 `@everyone` から Manage Channels 等の権限が剥奪されており、結果としてチャンネルのオーナーでさえ自分のチャンネルを編集できない状態になっている。

一方、管理者は6名のみで全員信頼済み。非管理者の自己管理権限だけを「自分のチャンネルに限って」選択的に取り戻したい。手動のDiscord権限管理では「他人のchに触れる権限を一人ずつ付与」の管理コストが非現実的。

Bot を噛ませることで:
- 非管理者は Slash Command 経由でのみ編集可能
- Bot が毎操作で「あなたはこのチャンネルのオーナーか？」を検証
- オーナー台帳は Bot 側が持ち、Discord の権限オーバーライドには依存しない

将来的には「荒らし自動検知 → 管理者通知 → ワンタッチ排除」まで拡張したいが、**MVP スコープ外**。

---

## 2. スコープ

### MVP に含む

- **対象**: 単一サーバ（`GUILD_ID` 1つ）、テキストチャンネルのみ（アーキテクチャは voice / category 拡張可能な形で実装）
- **Slash commands**: `create`, `rename`, `move`, `delete`, `settopic`, `claim`, `list`
- **制約**: 非管理者は **1人1チャンネル**
- **永続化**: Cloudflare D1 にオーナー台帳
- **監査**: 専用Discordチャンネルに操作イベントを best-effort 投稿

### MVP に含まない（将来拡張）

- 荒らし自動検知・管理者通知・ワンタッチ排除（Gateway が必要になるため別アーキへの移行を伴う）
- 命名規約の自動バリデーション
- Web管理UI、マルチサーバ対応
- voice / category への対応（D1スキーマは受け入れ準備済み）

---

## 3. 権限モデル

### オーナー判定の3階層

1. **管理者**: `ADMIN_ROLE_IDS` に含まれるロール保持者。全制約を無視し、全コマンドを任意のチャンネルに対して実行可能
2. **オーナー本人**: D1 のオーナー台帳で解決されたユーザー。自分のチャンネルに対する編集操作を実行可能
3. **それ以外**: 拒否（ephemeral 応答で本人にのみエラー表示）

### コマンド別権限マトリクス

| コマンド | 管理者 | オーナー本人 | その他 | 実行場所 |
|---------|-------|-------------|-------|---------|
| `/channel create <name>` | ◯（制約無視） | ◯（既存ch未所有時のみ） | ◯（同） | 個人chカテゴリ**外**で実行 |
| `/channel rename <new-name>` | ◯（任意ch） | ◯ | ✕ | 対象ch内 |
| `/channel move <position>` | ◯（cross-categoryは将来） | ◯（同カテゴリ内リオーダーのみ） | ✕ | 対象ch内 |
| `/channel delete` | ◯（確認ダイアログ付） | ◯（確認ダイアログ付） | ✕ | 対象ch内 |
| `/channel settopic <text>` | ◯ | ◯ | ✕ | 対象ch内 |
| `/channel claim <@user>` | ◯（マイグレ用） | ✕ | ✕ | 対象ch内 |
| `/channel list` | ◯ | ✕ | ✕ | どこでも |

### 失敗時の挙動

- 権限不足 → ephemeral応答で本人にのみ表示、Discord API / D1 には副作用ゼロ
- 1ch制約違反 → 同上
- 管理者への通知は MVP では行わない

### 実行場所ルール

- `create` を除くすべてのコマンドは **対象チャンネル内で実行**（`interaction.channel` が対象）
- これにより「別のchを指定ミスで操作してしまう」事故を防ぎ、UXもシンプル化
- `create` は個人chカテゴリ**外**で実行（カテゴリ内で実行されたら拒否）
- `list` は admin 専用なので実行場所制約なし

---

## 4. アーキテクチャ

### 技術スタック

- **ランタイム**: Cloudflare Workers（V8 isolate、HTTP Interactions エンドポイント）
- **ストレージ**: Cloudflare D1（SQLite、オーナー台帳の永続化）
- **言語**: TypeScript 5.x
- **ランタイム依存**:
  - `discord-api-types`（型定義のみ、ランタイムコード0）
  - `zod`（env / リクエストのバリデーション）
  - 署名検証: **WebCrypto API**（標準、ライブラリ不要）
- **開発依存**: `wrangler`, `vitest` + `@cloudflare/vitest-pool-workers`, `typescript`, `tsx`

### なぜ Workers + D1 か（decision log）

- 完全無料・クレカ不要・恒久運用可能（他の無料ホストは無料枠縮小傾向）
- ゼロ運用（プロセス監視・再起動不要）
- MVP の機能要件（slash command 処理、1人1ch制約、監査ログ）はすべて満たせる
- 制約: Gateway 非対応、手動編集のリアルタイム検知不可 → 管理者信頼モデルで許容
- 将来 Gateway 必要になった場合は Oracle Cloud 等に移植可能（ドメイン層は不変、transport 層のみ書き換え）

### ディレクトリ構成

```
src/
├── worker.ts                  # fetch handler: 署名検証 → type分岐 → エラーバウンダリ
├── config.ts                  # env / secrets の zod バリデーション（vars と secrets を統合したEnv型を定義）
├── verify.ts                  # Ed25519署名検証（WebCrypto、~30行）
├── discord/
│   ├── rest.ts                # 生 fetch + Bot Token 付与の薄いラッパ
│   └── types.ts               # discord-api-types からre-export
├── interactions/
│   ├── command-router.ts      # type=2: /command の振り分け
│   └── component-router.ts    # type=3: ボタン等の振り分け
├── commands/
│   ├── create.ts              # race mitigation（INSERT WHERE NOT EXISTS + 補償削除）
│   ├── rename.ts
│   ├── move.ts
│   ├── delete.ts              # コマンド側: 確認ボタン表示 + nonce登録
│   ├── settopic.ts
│   ├── claim.ts               # マイグレ完了後に削除
│   └── list.ts                # admin専用
├── components/
│   └── delete-confirm.ts      # ボタン押下時の実削除
├── ownership/
│   ├── store.ts               # D1アクセス層（read/write IF分離）
│   ├── events.ts              # OwnershipEvent型
│   ├── audit-log.ts           # ログch投稿（best effort）
│   └── permissions.ts         # resolveActorPermission(user, channel)
├── lib/
│   ├── errors.ts              # NotOwnerError / QuotaExceededError 等
│   └── result.ts              # Result<T, E>
└── index.ts                   # wrangler entry (worker.ts をexport)

scripts/
├── register-commands.ts       # slash command 登録（ローカルNode.js実行）
├── recovery.ts                # ログch → D1 再構築（災害復旧時のみ）
└── schema.sql                 # D1 初期スキーマ

wrangler.toml                  # Worker設定（D1 bind, vars, secrets参照）
```

### データフロー

#### 通常フロー例（`/channel rename`）

```
Discord → POST /interactions (Ed25519署名付)
  ↓
worker.ts
  ├─ 生 body 取得 → verify.ts で署名検証（失敗→401）
  ├─ JSON parse → interaction.type 判定
  ├─ type=1 (PING) → 即 PONG
  ├─ type=2 (COMMAND) → command-router.ts
  ├─ type=3 (COMPONENT) → component-router.ts
  └─ トップレベル try/catch: 未処理例外は ephemeral error response
     ↓
commands/rename.ts
  1. ownership/permissions.ts: D1 SELECT owner_id + actor.roles チェック
     → 拒否なら ephemeral 応答で早期return（Discord/D1 副作用ゼロ）
  2. discord/rest.ts: PATCH /channels/:id {name: new-name}
     → 失敗なら ephemeral エラー応答
  3. ownership/store.ts: UPDATE channels SET last_modified_at=?
     ※ Discord mutation 成功後に D1 更新が失敗した場合: Discord 側はロールバックしない。
       現行では検知のみ（`console.error`）、復旧は `scripts/recovery.ts` 手動実行。
  4. ownership/audit-log.ts: ログch投稿（best effort、失敗は console.error）
  5. 成功応答
```

#### 2段階インタラクション（`/channel delete`）

**ステップA（コマンド実行）**:
```
Discord → type=2 → commands/delete.ts
  1. 権限チェック
  2. D1 INSERT nonces (nonce, actor_id, channel_id, purpose='delete-confirm', expires_at=+60s)
  3. 応答: ephemeral メッセージ + 確認ボタン
     custom_id: "del-confirm:<ch_id>:<actor_id>:<nonce>"
```

**ステップB（ボタン押下）**:
```
Discord → type=3 → component-router.ts → components/delete-confirm.ts
  1. custom_id 解析 → nonce を D1 から取得 & 削除（one-shot）
     期限切れ / 見つからない → 拒否
  2. 押した人 == 記録された actor_id を確認
  3. Discord API: DELETE /channels/<ch_id>
  4. D1: DELETE FROM channels WHERE channel_id=?
  5. ログch投稿（best effort）
  6. type=7 (UPDATE_MESSAGE) で元のボタンメッセージを「削除しました」に書き換え
```

### 不変条件

1. **署名検証を通らないリクエストは即401**（Interaction以外の全リクエスト含む）
2. **D1 は常に Discord の実態と一致する真実の情報源**（ログch は best-effort ミラー）
3. **書き込み順序**: `Discord API mutation → D1 update → ログch投稿`
4. **`create` のみ例外**: Discord 作成 → D1 `INSERT WHERE NOT EXISTS` → affected=0 なら Discord 側を補償削除
5. **ボタン系 custom_id には必ず nonce を含め、D1 one-shot テーブルで1度限りで失効**
6. **worker.ts のトップレベル try/catch**: 未処理例外は必ず ephemeral error response で可視化（Discord に "アプリが応答しませんでした" を出させない）

### 署名検証の正しい手順（重要）

Ed25519 検証は **`timestamp + raw_body`** の連結に対して行うため、`JSON.parse` してから検証してはいけない:

```ts
async fetch(request, env) {
  const sig = request.headers.get('X-Signature-Ed25519');
  const ts  = request.headers.get('X-Signature-Timestamp');
  const raw = await request.text();                    // ← 生 text で保持
  if (!await verify(raw, sig, ts, env.DISCORD_PUBLIC_KEY)) {
    return new Response('invalid signature', { status: 401 });
  }
  const interaction = JSON.parse(raw);                 // ← 検証後にパース
  // ...
}
```

---

## 5. データモデル

### D1 スキーマ

```sql
-- scripts/schema.sql

CREATE TABLE channels (
  channel_id        TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  created_at        TEXT NOT NULL,       -- ISO8601
  last_modified_at  TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'text'
                      CHECK (kind IN ('text', 'voice', 'category'))
);
CREATE INDEX idx_channels_owner ON channels(owner_id);

-- 2段階インタラクションの one-shot nonce
CREATE TABLE nonces (
  nonce        TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  purpose      TEXT NOT NULL,            -- 'delete-confirm' 等
  expires_at   TEXT NOT NULL             -- ISO8601
);
CREATE INDEX idx_nonces_expires ON nonces(expires_at);
```

**nonce レコードの掃除方針（MVP）**: lazy delete のみ。参照時に `expires_at <= now()` を弾き、使用済み nonce は one-shot で `DELETE`。期限切れ未使用レコードは蓄積するが、`delete-confirm` の発行頻度は低く（個人Bot規模で日あたり数件）、D1 の行数上限（無料枠 5GB）まで到達する心配は無い。将来 cron が必要になれば `wrangler.toml [triggers]` で日次 `DELETE WHERE expires_at < ...` を追加可能。

### 1人1ch制約の実現

- actor が admin（`interaction.member.roles` をチェック）なら制約skip
- 非admin なら `INSERT INTO channels ... WHERE NOT EXISTS (SELECT 1 FROM channels WHERE owner_id=?)` で原子的に弾く
- affected=0 のとき、先行して作った Discord 側 chを `DELETE /channels/:id` で補償削除

### ログチャンネルのイベントスキーマ

1投稿 = 1イベント、JSON をコードブロックで囲んで人間も機械も読める形で:

```json
{"type":"channel_created","channel_id":"...","owner_id":"...","name":"...","kind":"text","actor_id":"...","ts":"2026-04-14T12:34:56Z"}
```

**イベント種別**:
- `channel_created` — create 成功時
- `channel_renamed` — rename 成功時（oldName, newName を含む）
- `channel_moved` — move 成功時（oldPosition, newPosition）
- `channel_topic_updated` — settopic 成功時（oldTopic, newTopic）
- `channel_deleted` — delete 成功時
- `ownership_claimed` — claim 成功時

全イベント共通フィールド: `type`, `channel_id`, `actor_id`, `ts`

### データ整合性の扱い

- Discord API mutation → D1 update → ログch投稿 の順
- D1 update まで成功していれば、ログch失敗は許容（best effort、`console.error` のみ）
- Discord mutation 成功 → D1 失敗: 現行では検知のみ、自動修復しない（`scripts/recovery.ts` を手動実行で復旧）
- 将来的に整合性チェック Cron を `wrangler.toml` の `[triggers] crons` で追加可能

---

## 6. デプロイと運用

### 前提条件（Discord側事前設定）

Bot を招待する前に以下を整えること:

1. `@everyone` ロールから `Manage Channels` / `Manage Roles` を剥奪（サーバ全体 or 対象カテゴリ）
2. `PERSONAL_CHANNELS_CATEGORY_ID` のカテゴリを作成（個人chの親）
3. `EVENT_LOG_CHANNEL_ID` のチャンネルを作成:
   - `@everyone`: View Channel 拒否
   - 管理者ロール: View Channel 許可
   - Bot ロール: Send Messages 許可
4. Bot ロールに **Manage Channels** を付与（全チャンネル操作に必要）

これらが整っていないと `/channel create` 等が黙って失敗する。セットアップ前に必ず確認。

### 環境変数と Secrets

**`wrangler.toml`（平文、コミットOK）**:
```toml
name = "discord-channel-manager"
main = "src/worker.ts"
compatibility_date = "2025-01-01"

[vars]
GUILD_ID = "..."
ADMIN_ROLE_IDS = "role_id_1,role_id_2"      # カンマ区切り
PERSONAL_CHANNELS_CATEGORY_ID = "..."
EVENT_LOG_CHANNEL_ID = "..."
LOG_LEVEL = "info"

[[d1_databases]]
binding = "DB"
database_name = "discord-channel-manager"
database_id = "..."                          # wrangler d1 create 後に転記
```

**Secrets（`wrangler secret put`、コミット禁止）**:
- `DISCORD_TOKEN` — Bot トークン
- `DISCORD_PUBLIC_KEY` — Ed25519署名検証用公開鍵（Developer Portalから取得）
- `DISCORD_APPLICATION_ID` — slash command 登録用

### Bot OAuth スコープと権限

- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Manage Channels`, `Send Messages`, `View Channel`, `Read Message History`

### 初回デプロイ手順

```bash
# 1. 依存インストール
npm install

# 2. Cloudflare ログイン
npx wrangler login

# 3. D1 データベース作成
npx wrangler d1 create discord-channel-manager
# → 出力された database_id を wrangler.toml にコピー

# 4. スキーマ適用
npx wrangler d1 execute discord-channel-manager --file=scripts/schema.sql

# 5. Secrets 登録
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID

# 6. Worker デプロイ
npx wrangler deploy
# → URL: https://discord-channel-manager.<subdomain>.workers.dev

# 7. Slash commands を Discord に登録（ローカルで1回だけ）
#    ギルドコマンドとして登録する（グローバル反映は最大1時間、ギルドは即時反映のため）
#    PUT /applications/:app_id/guilds/:guild_id/commands を使う
npx tsx scripts/register-commands.ts

# 8. Discord Developer Portal で
#    Application → General Information → Interactions Endpoint URL
#    に Worker の URL を設定
#    → Discord が PING を送信 → Worker が PONG → 登録完了

# 9. Bot を対象サーバに招待（生成したOAuth URL）
```

### 初回運用手順（既存チャンネルのマイグレーション）

1. `/channel list` で admin が全チャンネル状況を俯瞰
2. 各既存チャンネルに行き `/channel claim @owner` を実行（100chなら100回訪問）
3. 全チャンネルの所有権登録完了を `/channel list` で再確認
4. `src/commands/claim.ts` を削除 + `scripts/register-commands.ts` を再実行 + `wrangler deploy` でコマンド無効化

### Discord API レート制限

- 429 レスポンスを受けたら `discord/rest.ts` はログ出力 + `❌ Discord API が混んでいます` で失敗返却
- MVP では自動リトライしない（個人Bot規模では 429 はまず起きない）

---

## 7. テスト戦略

### Unit（vitest）

- `ownership/permissions.ts`: admin / owner / その他 の判定網羅
- `ownership/store.ts`: D1 モック（miniflare in-memory D1）で CRUD、`INSERT WHERE NOT EXISTS` の挙動
- `verify.ts`: Ed25519 検証の正常 / 異常（無効署名、改ざんbody、timestamp未来値等）
- `components/delete-confirm.ts`: nonce検証（期限切れ、重複使用、purpose不一致）

### Integration（vitest + @cloudflare/vitest-pool-workers）

- Workers ローカルエミュレータで HTTP POST → 応答の E2E 検証
- Discord REST API は `fetch` mock で固定応答
- 各コマンドの:
  - ハッピーパス
  - 権限拒否
  - race（同時 `create` 2連発で片方だけ成功する）
- **不変条件の回帰テスト**:
  - 署名検証失敗時に 401 を返すこと（不変条件 #1）
  - worker.ts 未処理例外時に ephemeral error response を返すこと（不変条件 #6）

### Manual E2E

- テスト用 Discord サーバに別 Bot アプリとしてデプロイ、実リクエストで smoke test
- CI未組込み（トークン秘匿のため手動実行のみ）

---

## 8. 将来拡張のポイント

このアーキテクチャで足せる機能:

- **voice / category 対応**: `ownership/store.ts` の `kind` 許可リスト拡張 + コマンドハンドラで種別分岐
- **荒らし検知（Gateway移行）**: Worker → Node.js 常駐ホストへ移行する場合、`ownership/*` と `commands/*` は流用、`worker.ts` / `discord/rest.ts` / 受信経路のみ書き換え
- **1人Nチャンネル制約**: D1 `COUNT` 判定の上限値を env 化するだけ
- **Cron整合性チェック**: `wrangler.toml` の `[triggers] crons = ["0 3 * * *"]` で 毎日D1 vs Discord実態を照合 → ログchに差分投稿
- **オーナー引き継ぎ（transfer）**: 将来引き継ぎ需要が発生したら追加。新旧オーナーへのDM通知付き

---

## 9. 主要な設計判断の記録（decision log）

| 判断 | 採用 | 棄却した代替案 | 理由 |
|------|------|-------------|------|
| Transport | HTTP Interactions | Gateway（WebSocket常駐） | Cloudflare Workers は常駐不可。MVPスコープ（slash command 処理）には HTTP で十分 |
| Host | Cloudflare Workers | Fly.io / Oracle Cloud / 自宅サーバ | クレカ不要・恒久無料・ゼロ運用。将来 Gateway 必要なら移植可能 |
| オーナー保存 | D1 テーブル | topic 埋め込み / Discord Permission Overwrite / 専用ログch再生 | topic はインジェクション可、Permission Overwrite は抽象的、ログch再生は Workers の per-request モデルで遅延。D1 は Discord API 経路から完全分離、O(1) lookup |
| ログチャンネル | best-effort の監査トレイル | 真実の情報源（前案） | Workers では D1 が直接・同期アクセス可能な唯一の永続ストア。ログch は遅延・失敗が避けられないので降格 |
| 1人1ch制約の列 | `is_admin_owned` なし | 列として snapshot | `interaction.member.roles` で毎回判定可能。admin時代作成の履歴を永続化する必要無し |
| `/channel move` | 同カテゴリ内リオーダー（owner）/ cross-category は admin 将来機能 | cross-category も許可 | 個人chは固定カテゴリ前提。cross-category は運用上の要件不明瞭 |
| `/channel delete` | 2段階（コマンド → 確認ボタン） | 1段階 | 取り返しのつかない操作、nonce付きボタンで誤操作防止 |
| SDK | 生 fetch + `discord-api-types`（型のみ） | `@discordjs/rest` | 依存最小、Workers ビルドサイズ削減、個人Bot規模なら高度なrate-limit管理不要 |

---

## つまりどういうことか

- **Cloudflare Workers + D1** で恒久無料・ゼロ運用の Discord 管理 Bot を作り、非管理者の編集権限を「自分のチャンネル限定」に選択的に戻す
- オーナー台帳は **D1**、監査ログは Discord チャンネルに **best-effort** 投稿、真実の情報源は D1 に一本化
- **HTTP Interactions** モデルで実装し、将来「荒らしリアルタイム検知」が必要になったら Gateway 対応ホストに移植（ドメイン層は流用可能）

---

# 2026-04-14 スコープ改訂 (v2)

実装中、スコープが過剰であると判明したため以下のとおり整理:

## 新スコープ

**コマンド(5種)**: `create` / `rename` / **`archive`** / `move` / `claim`(初回のみ)

- **`archive` を `delete` に置き換え**: ハード削除ではなく、アーカイブカテゴリに移動 + D1 に `archived_at` 記録。**Cron Trigger** で30日経過後に自動削除。誤操作の猶予期間を確保。
- **削除**: `settopic`, `list`, `transfer`, `info` (すべて YAGNI)
- **削除**: 監査ログ (ログ ch への投稿、`events.ts`, `audit-log.ts`, `recovery.ts`) — Discord の Audit Log で十分
- **削除**: 2段階削除確認ボタン、`nonces` テーブル、`component-router.ts`, `delete-confirm.ts` (archive は復旧可能なので確認不要)
- **削除**: race 補償削除ロジック (pre-check のみで十分、個人Bot規模ではrace起きない)

## 新アーキテクチャ差分

**環境変数**:
- 追加: `ARCHIVE_CATEGORY_ID` (アーカイブ先カテゴリ)
- 追加: `ARCHIVE_RETENTION_DAYS` (削除までの日数、デフォルト 30)
- 削除: `EVENT_LOG_CHANNEL_ID`

**D1 スキーマ (v2)**:
```sql
CREATE TABLE channels (
  channel_id   TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  archived_at  TEXT                    -- NULL = active, not NULL = archived
);
CREATE INDEX idx_channels_owner ON channels(owner_id);
CREATE INDEX idx_channels_archived ON channels(archived_at);
```

`nonces` テーブル廃止。

**wrangler.toml**:
```toml
[triggers]
crons = ["0 3 * * *"]   # 毎日 3am UTC
```

**Worker エントリ**:
- `fetch()` ハンドラ: 通常のインタラクション処理 (従来通り)
- `scheduled()` ハンドラ: cron起動時に `archived_at < NOW - ARCHIVE_RETENTION_DAYS` のチャンネルを Discord API で DELETE + D1 行削除

## archive コマンドの挙動

- チャンネル名を `[a]-{original-name}` にリネーム
- `parent_id` を `ARCHIVE_CATEGORY_ID` に変更
- D1 UPDATE: `SET archived_at = NOW`
- 復旧コマンドは MVP で作らない (管理者が手動でカテゴリ戻す)

## 設計意図の変化

- **真実の情報源**: 引き続き D1
- **監査目的**: Discord 自身の Audit Log に委譲 (Bot は投稿しない)
- **誤操作耐性**: archive + 猶予期間で担保 (2段階確認を不要にする)
