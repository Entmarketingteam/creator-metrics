"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import PeriodToggle from "./PeriodToggle";

// Earliest data in DB (LTK backfill starts 2024-01)
const ALL_TIME_START = "2024-01-01";

function daysToDateRange(value: string): { startDate: string; endDate: string } {
  const today = new Date().toISOString().split("T")[0];
  if (value === "all") return { startDate: ALL_TIME_START, endDate: today };
  const days = parseInt(value, 10);
  const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().split("T")[0];
  return { startDate: start, endDate: today };
}

function dateRangeToPeriod(startDate: string, endDate: string): string {
  if (startDate === ALL_TIME_START) return "all";
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
  if (days <= 31) return "30";
  if (days <= 92) return "90";
  if (days <= 366) return "365";
  if (days <= 732) return "730";
  return "all";
}

export default function PeriodSelector({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = dateRangeToPeriod(startDate, endDate);

  function handleChange(value: string) {
    const { startDate: s, endDate: e } = daysToDateRange(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("startDate", s);
    params.set("endDate", e);
    router.push(`${pathname}?${params.toString()}`);
  }

  return <PeriodToggle selected={selected} onChange={handleChange} />;
}
