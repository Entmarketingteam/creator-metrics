"use client";
import type { ScoreDistribution } from "@/lib/caption-queries";

export function CaptionScoreHistogram({ dist }: { dist: ScoreDistribution }) {
  const buckets = [
    { label: "0–25",    value: dist["0-25"],   color: "bg-red-500" },
    { label: "26–50",   value: dist["26-50"],  color: "bg-yellow-500" },
    { label: "51–75",   value: dist["51-75"],  color: "bg-indigo-500" },
    { label: "76–100",  value: dist["76-100"], color: "bg-green-500" },
  ];
  const max = Math.max(...buckets.map((b) => b.value), 1);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
        SEO Score Distribution
      </h3>
      <div className="space-y-3">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-14 text-right">{b.label}</span>
            <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
              <div
                className={`h-full ${b.color} rounded-full transition-all`}
                style={{ width: `${(b.value / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-6">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
