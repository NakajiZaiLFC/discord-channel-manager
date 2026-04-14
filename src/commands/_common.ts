import type { APIApplicationCommandInteraction } from '../discord/types.js';
import type { Env } from '../config.js';
import type { Store } from '../ownership/store.js';
import { resolveActorPermission, type ActorPermission } from '../ownership/permissions.js';
import { NotOwnerError, NotRegisteredError } from '../lib/errors.js';

export interface ActorContext {
  actorId: string;
  actorRoles: readonly string[];
  channelId: string;
  permission: ActorPermission;
}

export async function requireOwnerOrAdmin(
  interaction: APIApplicationCommandInteraction,
  env: Env,
  store: Store,
): Promise<ActorContext> {
  const member = interaction.member;
  if (!member) throw new NotOwnerError();
  const actorId = member.user.id;
  const actorRoles = member.roles;
  const channelId = interaction.channel_id as string;
  const ownerId = await store.getOwnerOf(channelId);
  const permission = resolveActorPermission({ actorId, actorRoles, ownerId, adminRoleIds: env.ADMIN_ROLE_IDS });
  if (permission === 'none') {
    if (ownerId === null) throw new NotRegisteredError();
    throw new NotOwnerError();
  }
  return { actorId, actorRoles, channelId, permission };
}

export function getSubcommandOption<T extends string | number>(
  interaction: APIApplicationCommandInteraction,
  name: string,
): T | undefined {
  const data = interaction.data as unknown as { options?: Array<{ type: number; options?: Array<{ name: string; value: unknown }> }> };
  const sub = data.options?.[0];
  const opt = sub?.options?.find(o => o.name === name);
  return opt?.value as T | undefined;
}
