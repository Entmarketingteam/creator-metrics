"use client";

import { BarChart } from "@tremor/react";
import { Zap } from "lucide-react";

interface DataPoint {
  date: string;
  Reach?: number;
  Engaged?: number;
  Interactions?: number;
}

export default function EngagementChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
        <p className="text-gray-500 text-sm">No engagement history yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-gray-400">28-Day Engagement</h3>
      </div>
      <BarChart
        data={data}
        index="date"
        categories={["Reach", "Engaged", "Interactions"]}
        colors={["blue", "cyan", "violet"]}
        showAnimation
        className="h-52"
      />
    </div>
  );
}
