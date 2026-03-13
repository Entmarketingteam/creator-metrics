import Image from "next/image";
import { PLATFORM_LABELS, PLATFORM_LOGO_ICON, PLATFORM_LOGO_INVERT } from "@/lib/utils";

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

  const logoSrc = PLATFORM_LOGO_ICON[key];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${colorClasses}`}
    >
      {logoSrc && (
        <Image
          src={logoSrc}
          alt={label}
          width={12}
          height={12}
          className={`object-contain ${PLATFORM_LOGO_INVERT.has(key) ? "invert opacity-70" : ""}`}
          unoptimized
        />
      )}
      {label}
    </span>
  );
}
