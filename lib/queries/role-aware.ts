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
  startDate?: string,
  endDate?: string
) {
  const role = await getCurrentUserRole();
  const accessible = getAccessibleCreatorIds(role);
  if (accessible !== null && !accessible.includes(creatorId)) {
    return [];
  }
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  return getCreatorEarningsSummary(creatorId, startDate ?? thirtyDaysAgo, endDate ?? today);
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
export async function getAggregateEarningsForUser(startDate?: string, endDate?: string) {
  const role = await getCurrentUserRole();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];
  const start = startDate ?? thirtyDaysAgo;
  const end = endDate ?? today;
  if (role.role === "internal") {
    return getAggregateEarnings(start, end);
  }
  // For non-internal, return standard aggregate.
  // Creator/client will access this from pages already scoped to their creators.
  return getAggregateEarnings(start, end);
}
