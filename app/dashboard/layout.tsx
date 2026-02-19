import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/creators", label: "Creators" },
  { href: "/dashboard/compare", label: "Compare" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r border-tremor-border bg-tremor-background-subtle p-6 flex flex-col">
        <Link href="/dashboard" className="text-xl font-bold text-tremor-content-strong mb-8">
          CreatorMetrics
        </Link>
        <nav className="flex flex-col gap-1 flex-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-tremor-content hover:bg-tremor-background-muted hover:text-tremor-content-emphasis transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="pt-4 border-t border-tremor-border">
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
