import type { Role } from "@scorehub/db";

// Higher number = more privilege. Used to enforce that ADMIN/MANAGER can
// only invite, promote, or remove members at or below their own rank — a
// MANAGER (delegated admin, no billing access) can't touch another ADMIN or
// MANAGER, preventing privilege escalation via the invite/member-management
// routes themselves.
const ROLE_RANK: Record<Role, number> = {
  ADMIN: 3,
  MANAGER: 2,
  OPERATOR: 1,
  VIEWER: 0,
};

// Creating, bulk-uploading and ending matches — everyone who can score a
// match (see /api/control-token) can also run its lifecycle.
export function canRunMatches(actorRole: Role | null | undefined): boolean {
  return actorRole === "ADMIN" || actorRole === "MANAGER" || actorRole === "OPERATOR";
}

export function canManageMembers(actorRole: Role | null): boolean {
  return actorRole === "ADMIN" || actorRole === "MANAGER";
}

// Whether `actorRole` is allowed to assign/invite `targetRole`, or act on an
// existing member who currently holds `targetRole` (change role / remove).
export function canActOnRole(actorRole: Role | null, targetRole: Role): boolean {
  if (actorRole === "ADMIN") return true;
  if (actorRole === "MANAGER") return ROLE_RANK[targetRole] < ROLE_RANK.MANAGER;
  return false;
}
