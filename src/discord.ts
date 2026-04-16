const BASE = 'https://discord.com/api/v10';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function createGuildChannel(
  token: string,
  guildId: string,
  opts: { name: string; type: number; parent_id: string },
): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ id: string }>;
}

export async function addPermissionOverride(
  token: string,
  channelId: string,
  userId: string,
): Promise<void> {
  const res = await fetch(`${BASE}/channels/${channelId}/permissions/${userId}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({
      type: 1,       // 1 = member
      allow: '16',   // MANAGE_CHANNELS = 1 << 4
    }),
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${await res.text()}`);
}

interface ChannelOverwrite {
  id: string;
  type: number;
  allow: string;
}

interface GuildChannel {
  id: string;
  parent_id?: string | null;
  permission_overwrites?: ChannelOverwrite[];
}

export async function getGuildChannels(
  token: string,
  guildId: string,
): Promise<GuildChannel[]> {
  const res = await fetch(`${BASE}/guilds/${guildId}/channels`, {
    method: 'GET',
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<GuildChannel[]>;
}
