"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  presetToDateRange,
  PRESETS,
  type Preset,
} from "@/lib/dateRangePresets";

// Re-export so tests can import from "@/components/DateRangePicker"
export { presetToDateRange, type Preset } from "@/lib/dateRangePresets";

// ── Component ────────────────────────────────────────────────────────────────

export default function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPreset = (searchParams.get("preset") ?? "30d") as Preset;
  const currentStart = searchParams.get("startDate") ?? "";
  const currentEnd = searchParams.get("endDate") ?? "";
  const showCustom = currentPreset === "custom";

  function applyPreset(preset: Preset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    if (preset !== "custom") {
      const { startDate, endDate } = presetToDateRange(preset);
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyCustom(startDate: string, endDate: string) {
    if (!startDate || !endDate) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", "custom");
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Preset chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESETS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => applyPreset(value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              currentPreset === value
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Active range label */}
      {currentStart && currentEnd && (
        <span className="text-xs text-gray-500 ml-1">
          {currentStart} – {currentEnd}
        </span>
      )}

      {/* Custom date inputs */}
      {showCustom && (
        <div className="flex items-center gap-2 mt-1 w-full">
          <input
            type="date"
            value={currentStart}
            max={currentEnd || undefined}
            onChange={(e) => applyCustom(e.target.value, currentEnd)}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none [color-scheme:dark]"
          />
          <span className="text-gray-600 text-xs">→</span>
          <input
            type="date"
            value={currentEnd}
            min={currentStart || undefined}
            onChange={(e) => applyCustom(currentStart, e.target.value)}
            className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-gray-200 focus:outline-none [color-scheme:dark]"
          />
        </div>
      )}
    </div>
  );
}
