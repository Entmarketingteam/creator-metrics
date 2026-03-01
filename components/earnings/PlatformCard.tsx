import Image from "next/image";
import { MousePointerClick, ShoppingCart, TrendingUp, RefreshCw, AlertCircle } from "lucide-react";
import { formatCurrency, PLATFORM_LABELS, PLATFORM_LOGO_WORDMARK, PLATFORM_LOGO_INVERT } from "@/lib/utils";

const PLATFORM_ACCENT: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  ltk: {
    bg: "bg-violet-500/5",
    border: "border-violet-500/20",
    text: "text-violet-400",
    icon: "text-violet-400",
  },
  shopmy: {
    bg: "bg-pink-500/5",
    border: "border-pink-500/20",
    text: "text-pink-400",
    icon: "text-pink-400",
  },
  mavely: {
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
    icon: "text-emerald-400",
  },
  amazon: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    text: "text-amber-400",
    icon: "text-amber-400",
  },
};

export interface PlatformCardData {
  platform: string;
  revenue: number;
  commission: number;
  clicks: number;
  orders: number;
  periodLabel: string;
  syncedAt: string | null;
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return "Never";
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function PlatformCard({ data }: { data: PlatformCardData }) {
  const key = data.platform.toLowerCase();
  const accent = PLATFORM_ACCENT[key] ?? {
    bg: "bg-gray-500/5",
    border: "border-gray-500/20",
    text: "text-gray-400",
    icon: "text-gray-400",
  };
  const label = PLATFORM_LABELS[key] ?? data.platform;
  const hasData = data.revenue > 0 || data.clicks > 0 || data.orders > 0;
  const cvr =
    data.clicks > 0
      ? ((data.orders / data.clicks) * 100).toFixed(1) + "%"
      : "—";

  return (
    <div
      className={`rounded-xl border ${accent.border} ${accent.bg} p-5 space-y-4`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        {PLATFORM_LOGO_WORDMARK[key] ? (
          <Image
            src={PLATFORM_LOGO_WORDMARK[key]}
            alt={label}
            height={20}
            width={80}
            className={`object-contain object-left h-5 w-auto ${PLATFORM_LOGO_INVERT.has(key) ? "invert opacity-80" : ""}`}
            unoptimized
          />
        ) : (
          <span className={`text-sm font-semibold ${accent.text}`}>{label}</span>
        )}
        {data.syncedAt ? (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <RefreshCw className="h-3 w-3" />
            {timeAgo(data.syncedAt)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-gray-600">
            <AlertCircle className="h-3 w-3" />
            No data
          </span>
        )}
      </div>

      {/* Main metric */}
      <div>
        <p className="text-2xl font-bold text-white">
          {formatCurrency(data.commission || data.revenue)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          commission · {data.periodLabel}
        </p>
      </div>

      {/* Stats row */}
      {hasData ? (
        <div className="grid grid-cols-3 gap-2 border-t border-gray-800 pt-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
              <MousePointerClick className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-white">
              {data.clicks.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Clicks</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
              <ShoppingCart className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-white">
              {data.orders.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Orders</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
              <TrendingUp className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-white">{cvr}</p>
            <p className="text-xs text-gray-500">CVR</p>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-600 text-center">Awaiting sync</p>
        </div>
      )}
    </div>
  );
}
