import { PLATFORM_LABELS } from "@/lib/utils";

const BADGE_COLORS: Record<string, string> = {
  mavely: "bg-emerald-500/10 text-emerald-400",
  shopmy: "bg-pink-500/10 text-pink-400",
  ltk: "bg-violet-500/10 text-violet-400",
  amazon: "bg-amber-500/10 text-amber-400",
  instagram: "bg-blue-500/10 text-blue-400",
};

interface PlatformBadgeProps {
  platform: string;
}

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
  const key = platform.toLowerCase();
  const colorClasses = BADGE_COLORS[key] ?? "bg-gray-500/10 text-gray-400";
  const label = PLATFORM_LABELS[key] ?? platform.charAt(0).toUpperCase() + platform.slice(1);

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colorClasses}`}
    >
      {label}
    </span>
  );
}
