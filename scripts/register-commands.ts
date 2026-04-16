import { config } from 'dotenv';
config();

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.DISCORD_TOKEN;

if (!APP_ID || !GUILD_ID || !TOKEN) {
  console.error('Missing env: DISCORD_APPLICATION_ID, GUILD_ID, DISCORD_TOKEN');
  process.exit(1);
}

const commands = [
  {
    name: 'channel',
    description: 'チャンネル管理',
    options: [
      {
        name: 'create',
        type: 1,
        description: '新しいチャンネルを作成',
        options: [
          { name: 'name', type: 3, description: 'チャンネル名', required: true },
        ],
      },
      {
        name: 'claim',
        type: 1,
        description: '[admin] 既存chにオーナーを割り当て',
        options: [
          { name: 'user', type: 6, description: 'オーナー', required: true },
        ],
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

const registered = (await res.json()) as unknown[];
console.log(`✅ ${registered.length} commands registered (guild-scoped)`);
