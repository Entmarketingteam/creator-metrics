import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, Users, GitCompareArrows, Brain } from "lucide-react";
import { db } from "@/lib/db";
import { creatorTokens } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { CreatorSelector } from "@/components/CreatorSelector";

const NAV_ITEMS = [
  { href: "/dashboard",                      label: "Overview",     icon: LayoutDashboard },
  { href: "/dashboard/creators",             label: "Creators",     icon: Users },
  { href: "/dashboard/compare",              label: "Compare",      icon: GitCompareArrows },
  { href: "/dashboard/intelligence/search",  label: "Intelligence", icon: Brain },
];

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { [key: string]: string };
}) {
  const { userId, sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  // Gate creators — must have connected Instagram
  if (role !== "admin") {
    if (!userId) redirect("/sign-in");
    const [token] = await db
      .select({ id: creatorTokens.id })
      .from(creatorTokens)
      .where(eq(creatorTokens.clerkUserId, userId!))
      .limit(1);
    if (!token) redirect("/onboarding");
  }

  // For admins — load creator list for selector
  let creatorIds: string[] = [];
  if (role === "admin") {
    const rows = await db.execute(
      sql`SELECT DISTINCT creator_id FROM creator_posts ORDER BY creator_id`
    );
    creatorIds = rows.rows.map((r: any) => r.creator_id);
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-gray-800 bg-gray-950 p-5 flex flex-col">
        <Link href="/dashboard" className="flex items-center gap-2 mb-8 px-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">CM</span>
          </div>
          <span className="text-lg font-bold text-white">CreatorMetrics</span>
        </Link>

        {role === "admin" && creatorIds.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider px-2 mb-2">Creator</p>
            <CreatorSelector creatorIds={creatorIds} />
          </div>
        )}

        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors"
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="pt-4 border-t border-gray-800 flex items-center gap-3 px-2">
          <UserButton afterSignOutUrl="/sign-in" />
          <span className="text-sm text-gray-500">ENT Agency</span>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-auto bg-gray-950">{children}</main>
    </div>
  );
}
