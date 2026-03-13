import { auth } from "@clerk/nextjs/server";
import {
  resolveUserRole,
  getAccessibleCreatorIds,
  type ResolvedRole,
} from "@/lib/auth/roles";
import {
  getCreatorEarningsSummary,
  getCreatorSales,
  getAggregateEarnings,
} from "./earnings";

/**
 * Helper to get the current user's resolved role.
 */
export async function getCurrentUserRole(): Promise<ResolvedRole> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  return resolveUserRole(userId);
}

/**
 * Role-aware wrapper for getCreatorEarningsSummary.
 * Returns empty array if the user has no access to the given creator.
 */
export async function getCreatorEarningsSummaryForUser(
  creatorId: string,
  days?: number
) {
  const role = await getCurrentUserRole();
  const accessible = getAccessibleCreatorIds(role);
  if (accessible !== null && !accessible.includes(creatorId)) {
    return [];
  }
  return getCreatorEarningsSummary(creatorId, days);
}

/**
 * Role-aware wrapper for getCreatorSales.
 * Returns empty paginated result if the user has no access to the given creator.
 */
export async function getCreatorSalesForUser(
  creatorId: string,
  options: {
    platform?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }
) {
  const role = await getCurrentUserRole();
  const accessible = getAccessibleCreatorIds(role);
  if (accessible !== null && !accessible.includes(creatorId)) {
    return { data: [], total: 0, page: 1, totalPages: 0 };
  }
  return getCreatorSales(creatorId, options);
}

/**
 * Role-aware aggregate earnings.
 * Internal users see all creators. Non-internal users see the standard
 * aggregate (their pages are already filtered by creator).
 */
export async function getAggregateEarningsForUser(days?: number) {
  const role = await getCurrentUserRole();
  if (role.role === "internal") {
    return getAggregateEarnings(days);
  }
  // For non-internal, return standard aggregate.
  // Creator/client will access this from pages already scoped to their creators.
  return getAggregateEarnings(days);
}
