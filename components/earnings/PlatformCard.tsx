import Image from "next/image";
import { MousePointerClick, ShoppingCart, TrendingUp, RefreshCw, AlertCircle } from "lucide-react";
import { formatCurrency, PLATFORM_LABELS, PLATFORM_LOGO_WORDMARK, PLATFORM_LOGO_INVERT } from "@/lib/utils";

const PLATFORM_ACCENT: Record<string, { bg: string; border: string; text: string; shadow: string }> = {
  ltk: {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-500 dark:text-violet-400",
    shadow: "hover:shadow-violet-500/20",
  },
  shopmy: {
    bg: "bg-pink-500/10",
    border: "border-pink-500/30",
    text: "text-pink-500 dark:text-pink-400",
    shadow: "hover:shadow-pink-500/20",
  },
  mavely: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-500 dark:text-emerald-400",
    shadow: "hover:shadow-emerald-500/20",
  },
  amazon: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-500 dark:text-amber-400",
    shadow: "hover:shadow-amber-500/20",
  },
};

export interface PlatformCardData {
  platform: string;
  revenue: number;
  commission: number;
  clicks: number | null;
  orders: number | null;
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
    bg: "bg-muted/50",
    border: "border-border",
    text: "text-muted-foreground",
    shadow: "",
  };
  const label = PLATFORM_LABELS[key] ?? data.platform;
  const hasData = data.revenue > 0 || (data.clicks != null && data.clicks > 0) || (data.orders != null && data.orders > 0);
  const cvr =
    data.clicks != null && data.clicks > 0 && data.orders != null
      ? ((data.orders / data.clicks) * 100).toFixed(1) + "%"
      : "—";

  return (
    <div
      className={`rounded-xl border ${accent.border} ${accent.bg} p-5 space-y-4 shadow-card dark:shadow-card-dark transition-shadow hover:shadow-lg ${accent.shadow}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        {PLATFORM_LOGO_WORDMARK[key] ? (
          <Image
            src={PLATFORM_LOGO_WORDMARK[key]}
            alt={label}
            height={24}
            width={100}
            className={`object-contain object-left h-6 w-auto ${PLATFORM_LOGO_INVERT.has(key) ? "dark:invert brightness-110" : ""}`}
            unoptimized
          />
        ) : (
          <span className={`text-sm font-semibold ${accent.text}`}>{label}</span>
        )}
        {data.syncedAt ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3" />
            {timeAgo(data.syncedAt)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
            <AlertCircle className="h-3 w-3" />
            No data
          </span>
        )}
      </div>

      {/* Main metric */}
      <div>
        <p className="text-2xl font-bold text-foreground">
          {formatCurrency(data.commission || data.revenue)}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          commission · {data.periodLabel}
        </p>
      </div>

      {/* Stats row */}
      {hasData ? (
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <MousePointerClick className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {data.clicks != null ? data.clicks.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Clicks</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <ShoppingCart className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {data.orders != null ? data.orders.toLocaleString() : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <TrendingUp className="h-3 w-3" />
            </div>
            <p className="text-sm font-semibold text-foreground">{cvr}</p>
            <p className="text-xs text-muted-foreground">CVR</p>
          </div>
        </div>
      ) : (
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground/60 text-center">Awaiting sync</p>
        </div>
      )}
    </div>
  );
}
