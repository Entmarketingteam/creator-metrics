"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TABS = [
  { path: "/dashboard/intelligence/search",   label: "Search"   },
  { path: "/dashboard/intelligence/insights",  label: "Insights" },
  { path: "/dashboard/intelligence/trends",    label: "Trends"   },
  { path: "/dashboard/intelligence/captions", label: "Captions" },
];

export function IntelligenceTabs() {
  const searchParams = useSearchParams();
  const creatorId = searchParams.get("creatorId");

  return (
    <nav className="flex gap-1 border-b border-gray-800 pb-0">
      {TABS.map((tab) => {
        const href = creatorId ? `${tab.path}?creatorId=${creatorId}` : tab.path;
        return (
          <Link
            key={tab.path}
            href={href}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border-b-2 border-transparent hover:border-gray-600 transition-colors -mb-px"
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
