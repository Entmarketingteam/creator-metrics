"use client";

import { AreaChart } from "@tremor/react";
import { TrendingUp } from "lucide-react";

interface DailyPoint {
  date: string;
  Commission: number;
}

export default function AmazonDailyChart({ data }: { data: DailyPoint[] }) {
  if (data.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Daily Earnings (Last 90 Days)</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Commission earned per day</p>
      <AreaChart
        data={data}
        index="date"
        categories={["Commission"]}
        colors={["amber"]}
        showAnimation
        className="h-52"
        yAxisWidth={64}
        valueFormatter={(v) => `$${v.toFixed(2)}`}
      />
    </div>
  );
}
