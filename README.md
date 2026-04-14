# discord-channel-manager

個人Discord サーバー向けの **チャンネル管理 Bot**。作成者または管理者のみが自分のチャンネルを編集できるよう、すべての編集操作を Slash Command 経由に統制する。

## 機能

### Slash Commands

| コマンド | 権限 | 説明 |
|----------|------|------|
| `/channel create <name>` | 誰でも (1人1ch制限、admin除外) | 個人chカテゴリに新規作成 |
| `/channel rename <new_name>` | オーナー / admin | このチャンネルの名前を変更 |
| `/channel move <position>` | オーナー / admin | 並び順を変更 |
| `/channel archive` | オーナー / admin | アーカイブ化（N日後に自動削除） |
| `/channel claim <@user>` | admin | 既存chにオーナーを登録（初回マイグレ用） |

### 自動化 (Cron)

毎日 3:00 UTC に、`ARCHIVE_RETENTION_DAYS` 日より前にアーカイブされたチャンネルを Discord から削除。D1 からも行を削除。

## アーキテクチャ

- **Runtime**: Cloudflare Workers (HTTP Interactions webhook)
- **Storage**: Cloudflare D1 (SQLite) — `channels` テーブル 1つだけ
- **Auth**: Ed25519 署名検証 (WebCrypto)
- **監査**: Discord 本体の Audit Log に委譲（Bot 側では残さない）

## 前提条件（Discord 側）

1. `@everyone` から `Manage Channels` / `Manage Roles` を剥奪
2. **個人chカテゴリ** を作成（`PERSONAL_CHANNELS_CATEGORY_ID`）
3. **アーカイブカテゴリ** を作成（`ARCHIVE_CATEGORY_ID`）
4. Bot ロールに `Manage Channels`, `Send Messages`, `View Channel`, `Read Message History` を付与

## セットアップ手順

```bash
# 1. 依存インストール
npm install

# 2. Cloudflare ログイン
npx wrangler login

# 3. D1 データベース作成
npx wrangler d1 create discord-channel-manager
# → 出力された database_id を wrangler.toml に転記

# 4. スキーマ適用 (remote)
npx wrangler d1 execute discord-channel-manager --remote --file=scripts/schema.sql

# 5. Secrets 登録
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID

# 6. wrangler.toml の [vars] に実IDを入力:
#    GUILD_ID / ADMIN_ROLE_IDS / PERSONAL_CHANNELS_CATEGORY_ID / ARCHIVE_CATEGORY_ID

# 7. Worker デプロイ
npx wrangler deploy

# 8. Slash command 登録（ローカルから1回だけ）
# .env に DISCORD_APPLICATION_ID / GUILD_ID / DISCORD_TOKEN を設定
npm run register-commands

# 9. Discord Developer Portal で Interactions Endpoint URL を設定
#    https://discord-channel-manager.<subdomain>.workers.dev/
#    Discord が PING を送信 → Worker が PONG → 登録完了

# 10. Bot を対象サーバーに招待（OAuth URL: bot + applications.commands scopes）
```

## 初回マイグレーション

既存チャンネルを Bot 管理下に取り込む:

```
[各既存チャンネル内で]
管理者: /channel claim @owner
```

全てのチャンネルに所有者を割り当てたら、`src/commands/claim.ts` と `src/commands/index.ts` の claim 登録を削除 → `npm run register-commands` 再実行 → `npx wrangler deploy` で claim を無効化。

## 環境変数リファレンス

| 変数 | 種別 | 説明 |
|------|------|------|
| `GUILD_ID` | var | 対象サーバー ID |
| `ADMIN_ROLE_IDS` | var | 管理者ロール ID（カンマ区切り） |
| `PERSONAL_CHANNELS_CATEGORY_ID` | var | 個人chカテゴリ ID |
| `ARCHIVE_CATEGORY_ID` | var | アーカイブカテゴリ ID |
| `ARCHIVE_RETENTION_DAYS` | var | アーカイブ保持日数（デフォルト 30） |
| `DISCORD_TOKEN` | secret | Bot トークン |
| `DISCORD_PUBLIC_KEY` | secret | Ed25519 公開鍵 (Developer Portal から) |
| `DISCORD_APPLICATION_ID` | secret | アプリ ID |

## コスト

すべて Cloudflare 無料枠内で動作（クレカ不要）:
- Workers: 100k req/日
- D1: 5GB, 25M 行読み取り/日, 50k 行書き込み/日
- Cron: 制限なし（1日1回実行のみ）

## トラブルシューティング

- **`/channel` が反応しない**: `register-commands` 未実行 or Interactions Endpoint URL 未設定
- **「このコマンドは個人chカテゴリ外で実行してください」**: `/channel create` は対象カテゴリ**外**で実行する必要あり
- **「このチャンネルは Bot に登録されていません」**: 管理者に `/channel claim @あなた` を依頼

## 設計ドキュメント

- 仕様: `docs/superpowers/specs/2026-04-14-discord-channel-manager-design.md`
- 実装計画: `docs/superpowers/plans/2026-04-14-discord-channel-manager.md`
