import { AuthenticatedUser } from '../types/domain';
import { HttpError } from '../utils/http';
import { featureFlags } from '../config/featureFlags';

export type Permission = 'analysis:run' | 'analysis:read' | 'analysis:export';

const rolePermissions: Record<string, Permission[]> = {
  authenticated: ['analysis:run', 'analysis:read', 'analysis:export'],
  service_role: ['analysis:run', 'analysis:read', 'analysis:export'],
  anon: []
};

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  const direct = user.permissions ?? [];
  if (direct.includes(permission)) return true;

  const roles = user.roles.length ? user.roles : ['authenticated'];
  return roles.some((role) => (rolePermissions[role] ?? []).includes(permission));
}

export function requirePermission(user: AuthenticatedUser, permission: Permission): void {
  if (!featureFlags.enableStrictPermissions) return;
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, `Missing permission: ${permission}`);
  }
}
