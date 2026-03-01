"use client";

import { BarChart } from "@tremor/react";
import { Tag } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export interface BrandRow {
  brand: string;
  commission: number;
  sales: number;
}

interface BrandBreakdownProps {
  data: BrandRow[];
}

export default function BrandBreakdown({ data }: BrandBreakdownProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 flex items-center justify-center min-h-[200px]">
        <p className="text-sm text-gray-500">No brand data for this period.</p>
      </div>
    );
  }

  const top10 = data.slice(0, 10);
  const chartData = top10.map((r) => ({
    brand: r.brand,
    Commission: r.commission,
  }));

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Tag className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-gray-400">Top Brands by Commission</h3>
      </div>

      <BarChart
        data={chartData}
        index="brand"
        categories={["Commission"]}
        colors={["pink"]}
        showAnimation
        showLegend={false}
        className="h-52"
        yAxisWidth={60}
        valueFormatter={(v) => formatCurrency(v)}
      />

      <div className="mt-4 space-y-2">
        {top10.map((row, i) => (
          <div
            key={row.brand}
            className="flex items-center gap-3 rounded-lg border border-gray-800/50 bg-gray-950/50 px-3 py-2"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-sm text-white">{row.brand}</span>
            <span className="text-xs text-gray-500">{row.sales} sales</span>
            <span className="text-sm font-semibold text-white">
              {formatCurrency(row.commission)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
