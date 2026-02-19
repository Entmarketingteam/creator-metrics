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
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{title}</p>
        {icon && <div className="text-gray-500">{icon}</div>}
      </div>
      <p className="text-2xl font-bold text-white mt-1">{formatted}</p>
      {change != null && change !== 0 && (
        <div className={`flex items-center gap-1 mt-1 text-sm ${change > 0 ? "text-emerald-400" : "text-red-400"}`}>
          {change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          <span>{change > 0 ? "+" : ""}{formatNumber(change)}</span>
        </div>
      )}
    </div>
  );
}
