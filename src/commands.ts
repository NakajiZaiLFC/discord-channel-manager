import { createGuildChannel, addPermissionOverride, getGuildChannels, patchChannel } from './discord.js';
import { messages } from './messages.js';

interface Env {
  GUILD_ID: string;
  ADMIN_ROLE_IDS: string;
  PERSONAL_CHANNELS_CATEGORY_ID: string;
  DISCORD_TOKEN: string;
}

interface InteractionResponse {
  type: number;
  data?: { content: string; flags?: number };
}

function ephemeral(content: string): InteractionResponse {
  return { type: 4, data: { content, flags: 64 } };
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

const MANAGE_CHANNELS = BigInt(0x10);
const GUILD_CATEGORY = 4;

// --- /channel create ---

export async function handleCreate(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const userId: string = interaction.member.user.id;
  const admin = isAdmin(interaction.member.roles, env.ADMIN_ROLE_IDS);

  const name = getOption(interaction, 'name');
  if (!name) return ephemeral(messages.createNoName());

  if (!admin) {
    const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
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

  return ephemeral(messages.createSuccess(`<#${created.id}>`));
}

// --- /channel claim ---

export async function handleClaim(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  if (!isAdmin(interaction.member.roles, env.ADMIN_ROLE_IDS)) {
    return ephemeral(messages.claimNotAdmin());
  }

  const target = getOption(interaction, 'user');
  if (!target) return ephemeral(messages.claimNoUser());

  const channelId: string = interaction.channel_id;
  await addPermissionOverride(env.DISCORD_TOKEN, channelId, target);

  return ephemeral(messages.claimSuccess(`<#${channelId}>`, `<@${target}>`));
}

// --- /move list ---

async function fetchCategories(env: Env) {
  const channels = await getGuildChannels(env.DISCORD_TOKEN, env.GUILD_ID);
  return channels
    .filter(c => c.type === GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function handleMoveList(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const categories = await fetchCategories(env);

  if (categories.length === 0) {
    return ephemeral('カテゴリが見つかりません');
  }

  const lines = categories.map((c, i) => `\`${i + 1}\`. ${c.name ?? '(名前なし)'}`);
  return ephemeral(`📁 **カテゴリ一覧**\n${lines.join('\n')}\n\n\`/move to <番号>\` で移動`);
}

// --- /move to ---

export async function handleMoveTo(
  interaction: any,
  env: Env,
): Promise<InteractionResponse> {
  const raw = getOption(interaction, 'category');
  const num = Number(raw);
  if (!raw || !Number.isInteger(num) || num < 1) {
    return ephemeral('❌ カテゴリ番号を正しく指定してください（`/move list` で確認）');
  }

  const categories = await fetchCategories(env);

  if (num > categories.length) {
    return ephemeral(`❌ カテゴリ番号は 1〜${categories.length} の範囲で指定してください`);
  }

  const target = categories[num - 1]!;
  const channelId: string = interaction.channel_id;

  await patchChannel(env.DISCORD_TOKEN, channelId, { parent_id: target.id });

  return ephemeral(`✅ カテゴリを「${target.name}」に移動しました`);
}

// --- /help ---

export function handleHelp(): InteractionResponse {
  return ephemeral(
    '📖 **コマンド一覧**\n\n' +
    '`/channel create <name>` — 新しいチャンネルを作成（1人1ch）\n' +
    '`/channel claim <@user>` — [admin] 既存chにオーナーを割り当て\n' +
    '`/move list` — カテゴリ一覧を表示\n' +
    '`/move to <番号>` — このチャンネルを指定カテゴリに移動\n' +
    '`/help` — このヘルプを表示',
  );
}
