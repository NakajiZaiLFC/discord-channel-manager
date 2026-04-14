import { DiscordApiError } from '../lib/errors.js';
import type { APIChannel } from './types.js';

const BASE = 'https://discord.com/api/v10';

export interface PatchChannelBody {
  name?: string;
  position?: number;
  parent_id?: string | null;
}

export interface CreateGuildChannelBody {
  name: string;
  type: number;
  parent_id: string;
}

export interface DiscordRest {
  patchChannel(channelId: string, body: PatchChannelBody): Promise<APIChannel>;
  deleteChannel(channelId: string): Promise<void>;
  createGuildChannel(guildId: string, body: CreateGuildChannelBody): Promise<APIChannel>;
  getChannel(channelId: string): Promise<APIChannel>;
  listGuildChannels(guildId: string): Promise<APIChannel[]>;
}

export function createDiscordRest(token: string, f: typeof fetch = fetch): DiscordRest {
  async function req(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (discord-channel-manager, 0.1)',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await f(`${BASE}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DiscordApiError(res.status, text);
    }
    return res;
  }
  return {
    async patchChannel(id, body) { return (await req('PATCH', `/channels/${id}`, body)).json() as Promise<APIChannel>; },
    async deleteChannel(id) { await req('DELETE', `/channels/${id}`); },
    async createGuildChannel(guildId, body) { return (await req('POST', `/guilds/${guildId}/channels`, body)).json() as Promise<APIChannel>; },
    async getChannel(id) { return (await req('GET', `/channels/${id}`)).json() as Promise<APIChannel>; },
    async listGuildChannels(guildId) { return (await req('GET', `/guilds/${guildId}/channels`)).json() as Promise<APIChannel[]>; },
  };
}
