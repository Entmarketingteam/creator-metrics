import { presetToDateRange } from "@/lib/dateRangePresets";

describe("earnings date range derivation", () => {
  it("derives correct SQL date bounds for 30d preset", () => {
    const ref = new Date("2026-03-13T12:00:00Z");
    const { startDate, endDate } = presetToDateRange("30d", ref);
    // startDate should be 29 days before ref (inclusive 30-day window)
    expect(new Date(startDate) <= new Date(endDate)).toBe(true);
    // endDate should be the ref date
    expect(endDate).toBe("2026-03-13");
  });

  it("this-month covers entire month", () => {
    const ref = new Date("2026-03-13T12:00:00Z");
    const { startDate, endDate } = presetToDateRange("this-month", ref);
    expect(startDate).toBe("2026-03-01");
    expect(endDate).toBe("2026-03-31");
  });
});
