import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { resolveUserRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { creators, userRoles, platformConnections } from "@/lib/schema";
import { desc } from "drizzle-orm";
import { Shield, Users, Link2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const resolved = await resolveUserRole(userId);
  if (resolved.role !== "internal") redirect("/dashboard");

  const [allCreators, allRoles, allConnections] = await Promise.all([
    db.select().from(creators).orderBy(desc(creators.createdAt)),
    db.select().from(userRoles).orderBy(desc(userRoles.createdAt)),
    db.select().from(platformConnections).orderBy(desc(platformConnections.createdAt)),
  ]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-gray-500">Manage creators, roles, and platform connections</p>
        </div>
      </div>

      {/* Creators */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">
            Creators ({allCreators.length})
          </h2>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-400 font-medium">Creator</th>
                <th className="text-left p-3 text-gray-400 font-medium">Username</th>
                <th className="text-left p-3 text-gray-400 font-medium">Mavely ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">ShopMy ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">LTK ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">Amazon Tag</th>
                <th className="text-left p-3 text-gray-400 font-medium">Owned</th>
              </tr>
            </thead>
            <tbody>
              {allCreators.map((c) => (
                <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="p-3 text-white font-medium">{c.displayName || c.id}</td>
                  <td className="p-3 text-gray-400">@{c.username}</td>
                  <td className="p-3 text-gray-400">{c.mavelyCreatorId || "—"}</td>
                  <td className="p-3 text-gray-400">{c.shopmyUserId || "—"}</td>
                  <td className="p-3 text-gray-400">{c.ltkPublisherId || "—"}</td>
                  <td className="p-3 text-gray-400">{c.amazonAssociateTag || "—"}</td>
                  <td className="p-3">
                    {c.isOwned ? (
                      <span className="text-emerald-400 text-xs font-medium">Yes</span>
                    ) : (
                      <span className="text-gray-500 text-xs">No</span>
                    )}
                  </td>
                </tr>
              ))}
              {allCreators.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-500">
                    No creators yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Roles */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">
            User Roles ({allRoles.length})
          </h2>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-400 font-medium">Clerk User ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">Role</th>
                <th className="text-left p-3 text-gray-400 font-medium">Creator ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">Assigned Creators</th>
              </tr>
            </thead>
            <tbody>
              {allRoles.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="p-3 text-white font-mono text-xs">{r.clerkUserId}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.role === "internal"
                          ? "bg-blue-500/10 text-blue-400"
                          : r.role === "client"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-emerald-500/10 text-emerald-400"
                      }`}
                    >
                      {r.role}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400">{r.creatorId || "—"}</td>
                  <td className="p-3 text-gray-400">{r.assignedCreatorIds || "—"}</td>
                </tr>
              ))}
              {allRoles.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-500">
                    No roles assigned yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Platform Connections */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-4 h-4 text-gray-400" />
          <h2 className="text-lg font-semibold text-white">
            Platform Connections ({allConnections.length})
          </h2>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-gray-400 font-medium">Creator</th>
                <th className="text-left p-3 text-gray-400 font-medium">Platform</th>
                <th className="text-left p-3 text-gray-400 font-medium">Connected</th>
                <th className="text-left p-3 text-gray-400 font-medium">External ID</th>
                <th className="text-left p-3 text-gray-400 font-medium">Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {allConnections.map((c) => (
                <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="p-3 text-white">{c.creatorId}</td>
                  <td className="p-3 text-gray-400 capitalize">{c.platform}</td>
                  <td className="p-3">
                    {c.isConnected ? (
                      <span className="text-emerald-400 text-xs">Connected</span>
                    ) : (
                      <span className="text-red-400 text-xs">Disconnected</span>
                    )}
                  </td>
                  <td className="p-3 text-gray-400 font-mono text-xs">{c.externalId || "—"}</td>
                  <td className="p-3 text-gray-400">
                    {c.lastSyncedAt
                      ? new Date(c.lastSyncedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Never"}
                  </td>
                </tr>
              ))}
              {allConnections.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-500">
                    No connections yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
