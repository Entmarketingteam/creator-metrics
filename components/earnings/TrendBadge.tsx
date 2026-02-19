"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

interface TrendBadgeProps {
  value: number;
  showIcon?: boolean;
}

export default function TrendBadge({ value, showIcon = true }: TrendBadgeProps) {
  const isPositive = value >= 0;
  const colorClass = isPositive ? "text-emerald-400" : "text-red-400";
  const formatted = `${isPositive ? "+" : ""}${value.toFixed(1)}%`;

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${colorClass}`}>
      {showIcon &&
        (isPositive ? (
          <TrendingUp className="h-3.5 w-3.5" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5" />
        ))}
      {formatted}
    </span>
  );
}
