"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number | null;
  icon?: React.ReactNode;
}

export default function MetricCard({ title, value, change, icon }: MetricCardProps) {
  const formatted = typeof value === "number" ? formatNumber(value) : value;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card dark:shadow-card-dark transition-shadow hover:shadow-glow">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <p className="text-2xl font-bold text-foreground mt-1">{formatted}</p>
      {change != null && change !== 0 && (
        <div className={`flex items-center gap-1 mt-1 text-sm ${change > 0 ? "text-emerald-500" : "text-red-500"}`}>
          {change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          <span>{change > 0 ? "+" : ""}{formatNumber(change)}</span>
        </div>
      )}
    </div>
  );
}
