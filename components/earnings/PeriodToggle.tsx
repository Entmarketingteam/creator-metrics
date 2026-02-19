"use client";

const PERIODS = [
  { label: "7d", value: "7" },
  { label: "30d", value: "30" },
  { label: "90d", value: "90" },
  { label: "1y", value: "365" },
];

interface PeriodToggleProps {
  selected: string;
  onChange: (value: string) => void;
}

export default function PeriodToggle({ selected, onChange }: PeriodToggleProps) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-gray-800 bg-gray-900 p-1">
      {PERIODS.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            selected === period.value
              ? "bg-gray-800 text-white"
              : "text-gray-400 hover:text-white"
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
