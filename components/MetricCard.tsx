"use client";

import { Card } from "@tremor/react";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number | null;
  suffix?: string;
}

export default function MetricCard({ title, value, change, suffix }: MetricCardProps) {
  const formatted = typeof value === "number" ? value.toLocaleString() : value;

  return (
    <Card className="p-4">
      <p className="text-tremor-content text-sm">{title}</p>
      <p className="text-2xl font-semibold text-tremor-content-strong mt-1">
        {formatted}
        {suffix && <span className="text-sm text-tremor-content ml-1">{suffix}</span>}
      </p>
      {change != null && (
        <p
          className={`text-sm mt-1 ${
            change >= 0 ? "text-emerald-500" : "text-red-500"
          }`}
        >
          {change >= 0 ? "+" : ""}
          {change.toLocaleString()}
        </p>
      )}
    </Card>
  );
}
