# Marvin — チャンネル管理ロボット

> 脳が惑星サイズなのに、やらされている仕事はチャンネルの権限設定です。

42 Tokyo の Discord サーバー向けチャンネル管理 Bot。チャンネル作成時に **作成者だけに編集権限（Permission Override）を自動付与** し、他人には触らせない。

## 仕組み

Discord の「権限オーバーライド」を利用。チャンネルごとに個別の権限例外を設定することで、**サーバー全体の権限を変えずに「自分のチャンネルだけ編集可能」** を実現する。

- データベースなし — Discord 自体が権限情報を保持
- Marvin が落ちても権限は消えない
- 編集・削除・並び替えは Discord の標準 UI で操作

## コマンド

| コマンド | 権限 | 説明 |
|---------|------|------|
| `/channel create <name>` | 誰でも（1人1ch、admin除外） | 指定カテゴリにチャンネル作成 + 権限付与 |
| `/channel claim <@user>` | admin のみ | 既存チャンネルに権限オーバーライドを後付け |

## アーキテクチャ

```
Discord → HTTP POST (署名付き) → Cloudflare Workers → Discord REST API
```

- **Runtime**: Cloudflare Workers（HTTP Interactions エンドポイント）
- **署名検証**: Ed25519 (WebCrypto)
- **ストレージ**: なし（Discord の Permission Overrides が情報源）
- **コスト**: Cloudflare 無料枠内（クレカ不要）

## 前提条件（Discord 側）

1. `@everyone` から `Manage Channels` を剥奪
2. チャンネル配置先のカテゴリを作成（ID をメモ）
3. Bot ロールに `Manage Channels`, `Manage Roles` を付与

## セットアップ

### 1. インストール

```bash
git clone https://github.com/<your-org>/discord-channel-manager.git
cd discord-channel-manager
npm install
```

### 2. 設定

`wrangler.toml` の `[vars]` に以下を記入:

| 変数 | 説明 |
|------|------|
| `GUILD_ID` | サーバー ID |
| `ADMIN_ROLE_IDS` | 管理者ロール ID（カンマ区切り） |
| `PERSONAL_CHANNELS_CATEGORY_ID` | チャンネル配置先カテゴリ ID |

### 3. デプロイ

```bash
npx wrangler login
npx wrangler deploy
```

### 4. Secrets 登録

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
```

### 5. コマンド登録

```bash
# .env に DISCORD_APPLICATION_ID / GUILD_ID / DISCORD_TOKEN を設定
npm run register-commands
```

### 6. Interactions Endpoint URL

Discord Developer Portal → Application → General Information → Interactions Endpoint URL に Worker の URL を入力。

### 7. Bot 招待

OAuth scopes: `bot`, `applications.commands`
Bot permissions: `Manage Channels`, `Manage Roles`

### 8. 初回マイグレーション

既存チャンネルに権限を後付け:

```
[各チャンネル内で]
管理者: /channel claim @owner
```

完了後、必要に応じて claim コマンドを無効化。

## Marvin の性格

Marvin は応答メッセージにランダムで異なる台詞を返します。仕事は正確ですが、本人は深く不満です。

## ライセンス

MIT
