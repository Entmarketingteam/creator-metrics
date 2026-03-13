"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import PeriodToggle from "./PeriodToggle";

export default function PeriodSelector({ days }: { days: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("days", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return <PeriodToggle selected={days} onChange={handleChange} />;
}
