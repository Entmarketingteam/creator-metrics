"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CREATORS } from "@/lib/creators";

// Build a lookup map from the static creator config
const CREATOR_DISPLAY: Record<string, string> = Object.fromEntries(
  CREATORS.map((c) => [c.id, c.displayName])
);

export function CreatorSelector({ creatorIds }: { creatorIds: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const current = searchParams.get("creatorId") ?? creatorIds[0] ?? "";

  function onChange(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("creatorId", id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-indigo-500 min-w-[160px]"
    >
      {creatorIds.map((id) => (
        <option key={id} value={id}>
          {CREATOR_DISPLAY[id] ?? id.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
