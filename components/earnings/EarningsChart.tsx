"use client";

import { BarChart } from "@tremor/react";
import { DollarSign } from "lucide-react";
import { PLATFORM_LABELS } from "@/lib/utils";

export interface ChartDataPoint {
  date: string;
  [platform: string]: string | number;
}

interface EarningsChartProps {
  data: ChartDataPoint[];
  platforms: string[];
}

const TREMOR_COLORS: Record<string, string> = {
  ltk: "violet",
  shopmy: "pink",
  mavely: "emerald",
  amazon: "amber",
};

export default function EarningsChart({ data, platforms }: EarningsChartProps) {
  if (data.length === 0 || platforms.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 flex items-center justify-center min-h-[200px]">
        <p className="text-sm text-gray-500">No revenue data for this period.</p>
      </div>
    );
  }

  const categories = platforms.map(
    (p) => PLATFORM_LABELS[p.toLowerCase()] ?? p
  );
  const colors = platforms.map((p) => TREMOR_COLORS[p.toLowerCase()] ?? "blue");

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-gray-400">
          Revenue Over Time
        </h3>
      </div>
      <BarChart
        data={data}
        index="date"
        categories={categories}
        colors={colors}
        showAnimation
        className="h-52"
        stack={false}
        yAxisWidth={56}
      />
    </div>
  );
}
