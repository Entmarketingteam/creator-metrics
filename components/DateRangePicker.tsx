"use client";

import { useRouter, usePathname } from "next/navigation";
import { CalendarRange, X } from "lucide-react";

interface DateRangePickerProps {
  from?: string;
  to?: string;
}

export default function DateRangePicker({ from, to }: DateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();

  function update(newFrom?: string, newTo?: string) {
    const params = new URLSearchParams();
    if (newFrom) params.set("from", newFrom);
    if (newTo) params.set("to", newTo);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clear() {
    router.push(pathname);
  }

  const isActive = !!from || !!to;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-gray-500">
        <CalendarRange className="w-3.5 h-3.5" />
        <span className="text-xs">Filter by date</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={from ?? ""}
          max={to ?? undefined}
          onChange={(e) => update(e.target.value || undefined, to)}
          className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-gray-500 [color-scheme:dark]"
        />
        <span className="text-gray-600 text-xs">→</span>
        <input
          type="date"
          value={to ?? ""}
          min={from ?? undefined}
          onChange={(e) => update(from, e.target.value || undefined)}
          className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none focus:border-gray-500 [color-scheme:dark]"
        />
        {isActive && (
          <button
            onClick={clear}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
