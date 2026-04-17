import { createGuildChannel, addPermissionOverride, getGuildChannels, patchChannel, type GuildChannel } from './discord.js';
import { messages } from './messages.js';

interface Env {
  GUILD_ID: string;
  ADMIN_ROLE_IDS: string;
  PERSONAL_CHANNELS_CATEGORY_ID: string;
  DISCORD_TOKEN: string;
}

interface InteractionResponse {
  type: number;
  data?: { content: string; flags?: number; components?: any[] };
}

function ephemeral(content: string, components?: any[]): InteractionResponse {
  return { type: 4, data: { content, flags: 64, components } };
}

function publicMsg(content: string): InteractionResponse {
  return { type: 4, data: { content } };
}

function updateMessage(content: string): InteractionResponse {
  return { type: 7, data: { content, components: [] } };
}

function getOption(interaction: any, name: string): string | undefined {
  return interaction.data?.options?.[0]?.options?.find(
    (o: any) => o.name === name,
  )?.value;
}

function isAdmin(memberRoles: string[], adminRoleIds: string): boolean {
  const admins = adminRoleIds.split(',').map(s => s.trim());
  return memberRoles.some(r => admins.includes(r));
}

function snowflakeToTimestamp(snowflake: string): number {
  return Number(BigInt(snowflake) >> 22n) + 1420070400000;
}

const MANAGE_CHANNELS = BigInt(0x10);
const GUILD_CATEGORY = 4;
const CHANNEL_WARN_THRESHOLD = 450;
const CHANNEL_LIMIT = 500;

// --- /channel create ---

export async function handleCreate(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const userId: string = interaction.member.user.id;
  const admin = isAdmin(interaction.member.roles, env.ADMIN_ROLE_IDS);

  const name = getOption(interaction, 'name');
  if (!name) return ephemeral(messages.createNoName());

  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);

  if (!admin) {
    const owns = channels
      .filter(c => c.parent_id === env.PERSONAL_CHANNELS_CATEGORY_ID)
      .some(c =>
        c.permission_overwrites?.some(
          o => o.type === 1 && o.id === userId && (BigInt(o.allow) & MANAGE_CHANNELS) !== 0n,
        ),
      );
    if (owns) {
      return ephemeral(messages.createAlreadyOwns());
    }
  }

  const created = await createGuildChannel(env.DISCORD_TOKEN, env.GUILD_ID, {
    name,
    type: 0,
    parent_id: env.PERSONAL_CHANNELS_CATEGORY_ID,
  });

  await addPermissionOverride(env.DISCORD_TOKEN, created.id, userId);

  // チャンネル数警告 (作成後なので +1)
  const totalCount = channels.length + 1;
  if (totalCount >= CHANNEL_WARN_THRESHOLD) {
    const adminMentions = env.ADMIN_ROLE_IDS.split(',').map(id => `<@&${id.trim()}>`).join(' ');
    return publicMsg(
      `✅ チャンネルを作成しました → <#${created.id}>\n\n` +
      `⚠️ **警告**: チャンネル数が **${totalCount}/${CHANNEL_LIMIT}** に達しています。${adminMentions}`,
    );
  }

  return ephemeral(messages.createSuccess(`<#${created.id}>`));
}

// --- /move → セレクトメニュー表示 ---

export async function handleMove(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const categories = channels
    .filter(c => c.type === GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (categories.length === 0) {
    return ephemeral('カテゴリが見つかりません');
  }

  const options = categories.slice(0, 25).map(c => ({
    label: c.name ?? '(名前なし)',
    value: c.id,
  }));

  return ephemeral('📁 移動先のカテゴリを選択してください', [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: 'move-category',
          placeholder: 'カテゴリを選択',
          options,
        },
      ],
    },
  ]);
}

// --- セレクト選択後の処理 ---

export async function handleMoveSelect(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const selectedId: string = interaction.data?.values?.[0];
  if (!selectedId) return updateMessage('❌ 選択が無効です');

  const channelId: string = interaction.channel_id;
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const target = channels.find(c => c.id === selectedId);

  await patchChannel(env.DISCORD_TOKEN, channelId, { parent_id: selectedId });

  return updateMessage(`✅ カテゴリを「${target?.name ?? selectedId}」に移動しました`);
}

// --- /stats ---

export async function handleStats(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);

  const categories = channels.filter(c => c.type === GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const nonCategories = channels.filter(c => c.type !== GUILD_CATEGORY);

  const lines: string[] = [];
  lines.push(`📊 **チャンネル統計**`);
  lines.push(`合計: **${channels.length}** / ${CHANNEL_LIMIT}（カテゴリ含む）\n`);

  for (const cat of categories) {
    const children = nonCategories.filter(c => c.parent_id === cat.id);
    lines.push(`📁 ${cat.name} — ${children.length}ch`);
  }

  const orphans = nonCategories.filter(c => !c.parent_id);
  if (orphans.length > 0) {
    lines.push(`📁 (カテゴリなし) — ${orphans.length}ch`);
  }

  return ephemeral(lines.join('\n'));
}

// --- /inactive ---

export async function handleInactive(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - SIX_MONTHS_MS;

  // テキストチャンネル(type=0)のみ対象
  const textChannels = channels.filter(c => c.type === 0);

  const inactive: Array<{ channel: GuildChannel; lastActivity: number | null }> = [];

  for (const ch of textChannels) {
    if (!ch.last_message_id) continue; // 発言なしは除外
    const ts = snowflakeToTimestamp(ch.last_message_id);
    if (ts < cutoff) {
      inactive.push({ channel: ch, lastActivity: ts });
    }
  }

  if (inactive.length === 0) {
    return ephemeral('✅ 半年以上未使用のチャンネルはありません');
  }

  // 古い順にソート
  inactive.sort((a, b) => (a.lastActivity ?? 0) - (b.lastActivity ?? 0));

  const lines = inactive.map(({ channel, lastActivity }) => {
    const date = lastActivity
      ? new Date(lastActivity).toISOString().slice(0, 10)
      : '発言なし';
    return `<#${channel.id}> — 最終: ${date}`;
  });

  const header = `🕸️ **半年以上未使用のチャンネル（${inactive.length}件）**\n`;

  // Discord の文字数制限 (2000) に収める
  let result = header;
  for (const line of lines) {
    if (result.length + line.length + 1 > 1900) {
      result += `\n…他 ${lines.length - result.split('\n').length + 1} 件`;
      break;
    }
    result += line + '\n';
  }

  return ephemeral(result);
}

// --- /help ---

export function handleHelp(): InteractionResponse {
  return ephemeral(
    '📖 **コマンド一覧**\n\n' +
    '`/channel create <name>` — 新しいチャンネルを作成（1人1ch）\n' +
    '`/move` — このチャンネルのカテゴリを移動\n' +
    '`/stats` — チャンネル数の統計\n' +
    '`/inactive` — 半年以上未使用のチャンネル一覧\n' +
    '`/help` — このヘルプを表示',
  );
}
