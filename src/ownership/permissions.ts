export type ActorPermission = 'admin' | 'owner' | 'none';

export interface ResolveArgs {
  actorId: string;
  actorRoles: readonly string[];
  ownerId: string | null;
  adminRoleIds: readonly string[];
}

export function isAdmin(actorRoles: readonly string[], adminRoleIds: readonly string[]): boolean {
  return actorRoles.some(r => adminRoleIds.includes(r));
}

export function resolveActorPermission(args: ResolveArgs): ActorPermission {
  if (isAdmin(args.actorRoles, args.adminRoleIds)) return 'admin';
  if (args.ownerId && args.actorId === args.ownerId) return 'owner';
  return 'none';
}
