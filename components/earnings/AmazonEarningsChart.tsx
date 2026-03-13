"use client";

import { BarChart } from "@tremor/react";
import { TrendingUp } from "lucide-react";

interface AmazonChartPoint {
  date: string;
  Commission: number;
  Revenue: number;
}

export default function AmazonEarningsChart({ data }: { data: AmazonChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 flex items-center justify-center min-h-[200px]">
        <p className="text-sm text-muted-foreground">No earnings data yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Monthly Earnings</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Commission earned per month</p>
      <BarChart
        data={data}
        index="date"
        categories={["Commission"]}
        colors={["amber"]}
        showAnimation
        className="h-52"
        yAxisWidth={64}
        valueFormatter={(v) =>
          v >= 1000 ? "$" + (v / 1000).toFixed(1) + "K" : "$" + v.toFixed(0)
        }
      />
    </div>
  );
}
