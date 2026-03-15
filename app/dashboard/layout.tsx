import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard,
  Users,
  GitCompareArrows,
  Brain,
  ImageIcon,
  DollarSign,
  Activity,
  MessageCircle,
  FlaskConical,
} from "lucide-react";
import { db } from "@/lib/db";
import { creatorTokens } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { CreatorSelector } from "@/components/CreatorSelector";
import DateRangePicker from "@/components/DateRangePicker";
import { Suspense } from "react";

const NAV_ITEMS = [
  { href: "/dashboard",                      label: "Overview",     icon: LayoutDashboard },
  { href: "/dashboard/earnings",             label: "Earnings",     icon: DollarSign },
  { href: "/dashboard/content",              label: "Content",      icon: ImageIcon },
  { href: "/dashboard/creators",             label: "Creators",     icon: Users },
  { href: "/dashboard/compare",              label: "Compare",      icon: GitCompareArrows },
  { href: "/dashboard/intelligence/search",  label: "Intelligence", icon: Brain },
  { href: "/dashboard/content-lab",          label: "Content Lab",  icon: FlaskConical },
  { href: "/dashboard/sync-health",          label: "Sync Health",  icon: Activity },
  { href: "/dashboard/manychat",             label: "ManyChat",     icon: MessageCircle },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as any)?.role as string | undefined;

  if (role !== "admin") {
    if (!userId) redirect("/sign-in");
    const [token] = await db
      .select({ id: creatorTokens.id })
      .from(creatorTokens)
      .where(eq(creatorTokens.clerkUserId, userId!))
      .limit(1);
    if (!token) redirect("/onboarding");
  }

  let creatorIds: string[] = [];
  if (role === "admin") {
    const rows = await db.execute(
      sql`SELECT DISTINCT creator_id FROM media_snapshots ORDER BY creator_id`
    );
    creatorIds = (Array.from(rows) as any[]).map((r: any) => r.creator_id);
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top filter bar ──────────────────────────────────────────── */}
      {role === "admin" && creatorIds.length > 0 && (
        <div className="border-b border-gray-800 bg-gray-950 px-6 py-3 flex items-center gap-4 flex-wrap sticky top-0 z-10">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Viewing</span>
          <Suspense>
            <CreatorSelector creatorIds={creatorIds} />
          </Suspense>
          <span className="text-gray-700">·</span>
          <Suspense>
            <DateRangePicker />
          </Suspense>
        </div>
      )}

      <div className="flex flex-1">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="w-56 border-r border-gray-800 bg-gray-950 p-4 flex flex-col shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2 mb-6 px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">CM</span>
            </div>
            <span className="text-base font-bold text-white">CreatorMetrics</span>
          </Link>

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
    </div>
  );
}
