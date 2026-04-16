# discord-channel-manager

Discord チャンネルの管理権限を**作成者本人と管理者だけ**に限定する Bot。

## 仕組み

チャンネル作成時に、**そのチャンネルだけ**に作成者への `Manage Channels` 権限オーバーライドを付与する。以降の編集・削除・並び替えは Discord の標準 UI で操作可能。他人のチャンネルは触れない。

## コマンド

| コマンド | 権限 | 説明 |
|---------|------|------|
| `/channel create <name>` | 誰でも（1人1ch、admin除外） | 個人chカテゴリにチャンネル作成 + 権限付与 |
| `/channel claim <@user>` | admin のみ | 既存chに権限オーバーライドを後付け |

## セットアップ

### 1. Discord 側の準備

- `@everyone` から `Manage Channels` を剥奪
- **個人chカテゴリ** を作成（ID をメモ）
- Bot ロールに `Manage Channels`, `Manage Roles`, `View Channel` を付与

### 2. Cloudflare にデプロイ

```bash
npm install
npx wrangler login
npx wrangler deploy
```

### 3. 設定

```bash
# wrangler.toml の [vars] に記入:
#   GUILD_ID, ADMIN_ROLE_IDS, PERSONAL_CHANNELS_CATEGORY_ID

# Secrets:
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
```

### 4. コマンド登録

```bash
# .env に DISCORD_APPLICATION_ID / GUILD_ID / DISCORD_TOKEN を設定
npm run register-commands
```

### 5. Interactions Endpoint URL を設定

Discord Developer Portal → Application → Interactions Endpoint URL に Worker の URL を入力。

### 6. Bot をサーバーに招待

OAuth scopes: `bot`, `applications.commands`
Bot permissions: `Manage Channels`, `Manage Roles`, `View Channel`

### 7. 初回マイグレーション

既存チャンネルに権限を付与:

```
[各チャンネル内で]
管理者: /channel claim @owner
```

全チャンネル完了後、必要に応じて claim コマンドを削除。
