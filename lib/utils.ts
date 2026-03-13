import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

export function engagementRate(
  likes: number | null,
  comments: number | null,
  followers: number | null
): string {
  if (!followers || followers === 0) return "—";
  const total = (likes ?? 0) + (comments ?? 0);
  return ((total / followers) * 100).toFixed(2) + "%";
}

export function formatCurrency(n: number | string | null | undefined): string {
  if (n == null) return "$0.00";
  const val = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(val)) return "$0.00";
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null) return "0%";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${n.toFixed(1)}%`;
}

export const PLATFORM_COLORS: Record<string, string> = {
  mavely: "emerald",
  shopmy: "pink",
  ltk: "violet",
  amazon: "amber",
  instagram: "blue",
};

export const PLATFORM_LABELS: Record<string, string> = {
  mavely: "Mavely",
  shopmy: "ShopMy",
  ltk: "LTK",
  amazon: "Amazon",
  instagram: "Instagram",
};

/** Full wordmark logos — for larger display (PlatformCard headers) */
export const PLATFORM_LOGO_WORDMARK: Record<string, string> = {
  mavely: "/logos/mavely.png",
  ltk: "/logos/ltk.png",
  shopmy: "/logos/shopmy.png",
};

/** Square icon logos — for compact display (badges, pills) */
export const PLATFORM_LOGO_ICON: Record<string, string> = {
  mavely: "/logos/mavely.png",
  ltk: "/logos/ltk.png",
  shopmy: "/logos/shopmy-icon.png",
};

/** Platforms whose logos need CSS invert on dark backgrounds (black logos on white) */
export const PLATFORM_LOGO_INVERT = new Set(["ltk", "shopmy"]);
