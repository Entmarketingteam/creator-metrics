"use client";

import { AreaChart } from "@tremor/react";
import { DollarSign } from "lucide-react";

interface DataPoint {
  date: string;
  Revenue: number;
}

interface EarningsChartProps {
  data: DataPoint[];
}

export default function EarningsChart({ data }: EarningsChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
        <p className="text-sm text-gray-500">No earnings data yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-gray-400">
          Revenue Over Time
        </h3>
      </div>
      <AreaChart
        data={data}
        index="date"
        categories={["Revenue"]}
        colors={["blue"]}
        showAnimation
        className="h-52"
        curveType="monotone"
      />
    </div>
  );
}
