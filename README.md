# discord-channel-manager

指定サーバー内のチャンネル操作（作成・リネーム・並べ替え・削除）を、すべてこのbot経由で統制するためのDiscord管理bot。

## 目的

Discordの手動チャンネル操作を禁止し、以下をすべてbot経由にする:

- チャンネル作成
- チャンネル名変更
- チャンネル位置移動（並べ替え）
- チャンネル削除

これにより:

- 操作ログが残る（誰が何をいつ）
- 命名規約・カテゴリ構造の自動バリデーション
- うっかり削除/移動の防止
- 設定をコード化（IaC的発想）してレビュー可能にできる余地

## スコープ（MVP）

### 対象
- [ ] 単一サーバー（`GUILD_ID` を1つ指定）
- [ ] テキストチャンネル / ボイスチャンネル / カテゴリ
- [ ] Slash commands ベースの操作UI

### 非対象（将来拡張）
- マルチサーバー対応
- ロール・権限管理
- スレッド管理
- Web管理画面

## Slash Commands（設計案）

| コマンド | 機能 | 権限 |
|---------|------|------|
| `/channel create <name> [category] [type]` | チャンネル作成 | admin |
| `/channel rename <channel> <new-name>` | リネーム | admin |
| `/channel move <channel> <position>` | 位置移動 | admin |
| `/channel delete <channel>` | 削除（確認フロー付き） | admin |
| `/channel list [category]` | 現状一覧 | all |
| `/channel sync` | 理想状態との差分適用（将来） | admin |

## アーキテクチャ候補

### Option A: TypeScript + discord.js（推奨）
- 既存 `discord-bot-cc` で実績あり、ノウハウ流用可能
- エコシステム最大
- Slash command SDK が成熟

### Option B: Python + discord.py
- コード短く書ける
- 非同期処理は両者同等

### Option C: Rust + serenity
- 軽量・高速だが学習コスト

→ **まずはTypeScript+discord.jsで着手**

## 運用上の前提

- Discord側で「チャンネル管理」権限を持つのはbotのみにする
- 人間の管理者はbotを介してのみ操作
- 操作履歴はログチャンネルに自動投稿

## ディレクトリ構成（予定）

```
discord-channel-manager/
├── README.md              # this file
├── .env.example           # 環境変数テンプレート
├── .gitignore
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # エントリポイント
│   ├── commands/          # Slash command 実装
│   │   ├── create.ts
│   │   ├── rename.ts
│   │   ├── move.ts
│   │   ├── delete.ts
│   │   └── list.ts
│   ├── lib/
│   │   ├── logger.ts      # 操作ログ
│   │   └── permissions.ts # 権限チェック
│   └── config.ts
├── tests/
└── docs/
    └── design.md          # 設計判断の記録
```

## 環境変数（設計中）

| 変数 | 必須 | 説明 |
|------|------|------|
| `DISCORD_TOKEN` | Yes | Bot トークン |
| `GUILD_ID` | Yes | 対象サーバーID |
| `ADMIN_ROLE_IDS` | Yes | 操作可能ロールID（カンマ区切り） |
| `LOG_CHANNEL_ID` | Yes | 操作ログ送信先 |

## 次のステップ

- [ ] 対象サーバーを決定（Guild ID取得）
- [ ] Discord Developer Portalでbot作成 → token取得
- [ ] `package.json` / `tsconfig.json` / `.gitignore` 作成
- [ ] `discord.js` セットアップ + 疎通確認（ping command）
- [ ] `/channel create` から順次実装
- [ ] 操作ログ出力機能

## 関連

- Vault: `05_projects/discord-bot/README.md`
- 参考プロジェクト: `~/projects/discord-bot-cc/` （Claude Codeプロキシbot、構成流用元）
