import { db } from "@/lib/db";
import { userRoles } from "@/lib/schema";
import { eq } from "drizzle-orm";

export type UserRole = "internal" | "client" | "creator";

export interface ResolvedRole {
  role: UserRole;
  creatorId: string | null;
  assignedCreatorIds: string[];
}

/**
 * Resolve a Clerk user ID to a role. Falls back to "creator" if not found.
 */
export async function resolveUserRole(
  clerkUserId: string
): Promise<ResolvedRole> {
  const [row] = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.clerkUserId, clerkUserId))
    .limit(1);

  if (!row) {
    return { role: "creator", creatorId: null, assignedCreatorIds: [] };
  }

  return {
    role: row.role as UserRole,
    creatorId: row.creatorId ?? null,
    assignedCreatorIds: row.assignedCreatorIds
      ? row.assignedCreatorIds.split(",").map((id) => id.trim()).filter(Boolean)
      : [],
  };
}

/**
 * Check if a user can access a specific creator's data.
 */
export function canAccessCreator(
  resolved: ResolvedRole,
  creatorId: string
): boolean {
  if (resolved.role === "internal") return true;
  if (resolved.role === "creator") return resolved.creatorId === creatorId;
  if (resolved.role === "client")
    return resolved.assignedCreatorIds.includes(creatorId);
  return false;
}

/**
 * Get the list of creator IDs a user can see.
 * Internal: returns null (meaning all).
 * Client: returns assignedCreatorIds.
 * Creator: returns [creatorId].
 */
export function getAccessibleCreatorIds(
  resolved: ResolvedRole
): string[] | null {
  if (resolved.role === "internal") return null;
  if (resolved.role === "client") return resolved.assignedCreatorIds;
  if (resolved.role === "creator" && resolved.creatorId)
    return [resolved.creatorId];
  return [];
}
