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
