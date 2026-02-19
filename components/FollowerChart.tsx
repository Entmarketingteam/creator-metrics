"use client";

import { AreaChart, Card } from "@tremor/react";

interface DataPoint {
  date: string;
  Followers: number;
}

export default function FollowerChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-tremor-content text-sm">No follower history yet. Data populates daily.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-tremor-content mb-4">Follower Growth</h3>
      <AreaChart
        data={data}
        index="date"
        categories={["Followers"]}
        colors={["blue"]}
        showAnimation
        className="h-60"
        curveType="monotone"
      />
    </Card>
  );
}
