import { describe, it, expect } from 'vitest';
import { resolveActorPermission, isAdmin } from '../../src/ownership/permissions.js';

const adminRoles = ['admin1', 'admin2'];

describe('resolveActorPermission', () => {
  it('admin role 保持者は "admin"', () => {
    expect(resolveActorPermission({ actorId: 'u1', actorRoles: ['admin1'], ownerId: 'u2', adminRoleIds: adminRoles })).toBe('admin');
  });
  it('actor == owner は "owner"', () => {
    expect(resolveActorPermission({ actorId: 'u1', actorRoles: [], ownerId: 'u1', adminRoleIds: adminRoles })).toBe('owner');
  });
  it('他人は "none"', () => {
    expect(resolveActorPermission({ actorId: 'u1', actorRoles: [], ownerId: 'u2', adminRoleIds: adminRoles })).toBe('none');
  });
  it('ownerId=null で非admin は "none"', () => {
    expect(resolveActorPermission({ actorId: 'u1', actorRoles: [], ownerId: null, adminRoleIds: adminRoles })).toBe('none');
  });
  it('ownerId=null でも admin は "admin"', () => {
    expect(resolveActorPermission({ actorId: 'u1', actorRoles: ['admin1'], ownerId: null, adminRoleIds: adminRoles })).toBe('admin');
  });
});

describe('isAdmin', () => {
  it('admin role あり → true', () => {
    expect(isAdmin(['admin1'], adminRoles)).toBe(true);
  });
  it('admin role なし → false', () => {
    expect(isAdmin(['other'], adminRoles)).toBe(false);
  });
});
