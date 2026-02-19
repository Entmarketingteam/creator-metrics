import PlatformBadge from "./PlatformBadge";
import { formatCurrency, PLATFORM_COLORS } from "@/lib/utils";

interface PlatformRow {
  platform: string;
  revenue: number;
  percentage: number;
}

interface PlatformBreakdownProps {
  data: PlatformRow[];
}

const BAR_BG_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500/20",
  pink: "bg-pink-500/20",
  violet: "bg-violet-500/20",
  amber: "bg-amber-500/20",
  blue: "bg-blue-500/20",
};

const BAR_FG_COLORS: Record<string, string> = {
  emerald: "bg-emerald-500",
  pink: "bg-pink-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
};

export default function PlatformBreakdown({ data }: PlatformBreakdownProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-400">
        Platform Breakdown
      </h3>

      {data.length === 0 ? (
        <p className="text-sm text-gray-500">No platform data yet.</p>
      ) : (
        <div className="space-y-3">
          {data.map((row) => {
            const colorKey =
              PLATFORM_COLORS[row.platform.toLowerCase()] ?? "blue";
            const barBg = BAR_BG_COLORS[colorKey] ?? "bg-gray-500/20";
            const barFg = BAR_FG_COLORS[colorKey] ?? "bg-gray-500";

            return (
              <div key={row.platform} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platform={row.platform} />
                    <span className="text-xs text-gray-500">
                      {row.percentage.toFixed(1)}%
                    </span>
                  </div>
                  <span className="text-sm font-medium text-white">
                    {formatCurrency(row.revenue)}
                  </span>
                </div>
                <div className={`relative h-2 w-full overflow-hidden rounded-full ${barBg}`}>
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${barFg}`}
                    style={{ width: `${Math.min(row.percentage, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
