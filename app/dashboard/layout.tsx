import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, Users, GitCompareArrows } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/creators", label: "Creators", icon: Users },
  { href: "/dashboard/compare", label: "Compare", icon: GitCompareArrows },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-800 bg-gray-950 p-5 flex flex-col">
        <Link href="/dashboard" className="flex items-center gap-2 mb-8 px-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">CM</span>
          </div>
          <span className="text-lg font-bold text-white">CreatorMetrics</span>
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

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto bg-gray-950">{children}</main>
    </div>
  );
}
