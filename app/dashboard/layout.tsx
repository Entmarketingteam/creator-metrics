"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  LayoutDashboard,
  Users,
  GitCompareArrows,
  DollarSign,
  Package,
  Shield,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/creators", label: "Creators", icon: Users },
  { href: "/dashboard/earnings", label: "Earnings", icon: DollarSign },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/dashboard/admin", label: "Admin", icon: Shield },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Sidebar (desktop only) ──────────────────────────────── */}
      <aside className="hidden md:flex w-64 border-r border-border bg-card shadow-card-dark flex-col shrink-0">
        <div className="p-5 flex flex-col h-full">
          <Link href="/dashboard" className="flex items-center gap-2 mb-8 px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-glow">
              <span className="text-white font-bold text-sm">CM</span>
            </div>
            <span className="text-lg font-bold text-foreground">CreatorMetrics</span>
          </Link>

          <nav className="flex flex-col gap-1 flex-1">
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-accent text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-border flex items-center gap-3 px-2">
            <UserButton afterSignOutUrl="/sign-in" />
            <span className="text-sm text-muted-foreground flex-1">ENT Agency</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <div className="p-4 sm:p-6 md:p-8">{children}</div>
      </main>

      {/* ── Bottom nav (mobile only) ─────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex items-center justify-around px-2 py-2 safe-pb shadow-[0_-4px_24px_0_rgb(0_0_0_/_0.15)]">
        {NAV_ITEMS.slice(0, 5).map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
