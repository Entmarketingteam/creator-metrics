"use client";

import { AreaChart } from "@tremor/react";
import { TrendingUp } from "lucide-react";

interface DailyPoint {
  date: string;
  Commission: number;
  Revenue?: number;
  Orders?: number;
}

export default function AmazonDailyChart({
  data,
  title,
}: {
  data: DailyPoint[];
  title?: string;
}) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">
          {title ?? "Daily Earnings"}
        </h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Commission and revenue per day
      </p>
      <AreaChart
        data={data}
        index="date"
        categories={["Commission", "Revenue"]}
        colors={["amber", "orange"]}
        showAnimation
        className="h-56"
        yAxisWidth={72}
        valueFormatter={(v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
      />
    </div>
  );
}
