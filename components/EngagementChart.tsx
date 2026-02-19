"use client";

import { BarChart, Card } from "@tremor/react";

interface DataPoint {
  date: string;
  Reach?: number;
  Engaged?: number;
  Interactions?: number;
}

export default function EngagementChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-tremor-content text-sm">No engagement history yet.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-tremor-content mb-4">28-Day Engagement Trends</h3>
      <BarChart
        data={data}
        index="date"
        categories={["Reach", "Engaged", "Interactions"]}
        colors={["blue", "cyan", "violet"]}
        showAnimation
        className="h-60"
      />
    </Card>
  );
}
