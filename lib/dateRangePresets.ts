// ── Date math (pure, no React deps) ─────────────────────────────────────────

export function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

export type Preset =
  | "7d"
  | "30d"
  | "90d"
  | "this-month"
  | "last-month"
  | "ytd"
  | "custom";

export function presetToDateRange(
  preset: string,
  ref: Date = new Date()
): { startDate: string; endDate: string } {
  const today = toISO(ref);
  const y = ref.getFullYear();
  const m = ref.getMonth(); // 0-indexed

  if (preset === "7d") {
    const start = new Date(ref);
    start.setDate(start.getDate() - 6);
    return { startDate: toISO(start), endDate: today };
  }
  if (preset === "90d") {
    const start = new Date(ref);
    start.setDate(start.getDate() - 89);
    return { startDate: toISO(start), endDate: today };
  }
  if (preset === "this-month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  if (preset === "last-month") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { startDate: toISO(start), endDate: toISO(end) };
  }
  if (preset === "ytd") {
    return { startDate: `${y}-01-01`, endDate: today };
  }
  // default: 30d (covers "30d" and unknown)
  const start = new Date(ref);
  start.setDate(start.getDate() - 29);
  return { startDate: toISO(start), endDate: today };
}

export const PRESETS: { label: string; value: Preset }[] = [
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "YTD", value: "ytd" },
  { label: "Custom", value: "custom" },
];
