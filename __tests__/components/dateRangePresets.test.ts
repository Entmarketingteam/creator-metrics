// Pure date logic extracted to lib so Jest (node env, no JSX transform) can import it
import { presetToDateRange } from "@/lib/dateRangePresets";

describe("presetToDateRange", () => {
  // Fix the reference date so tests are deterministic
  const REF = new Date("2026-03-13T12:00:00Z");

  it("7d: returns last 7 days", () => {
    const { startDate, endDate } = presetToDateRange("7d", REF);
    expect(startDate).toBe("2026-03-07");
    expect(endDate).toBe("2026-03-13");
  });

  it("30d: returns last 30 days", () => {
    const { startDate, endDate } = presetToDateRange("30d", REF);
    expect(startDate).toBe("2026-02-12");
    expect(endDate).toBe("2026-03-13");
  });

  it("90d: returns last 90 days", () => {
    const { startDate, endDate } = presetToDateRange("90d", REF);
    expect(startDate).toBe("2025-12-14");
    expect(endDate).toBe("2026-03-13");
  });

  it("this-month: returns first to last day of current month", () => {
    const { startDate, endDate } = presetToDateRange("this-month", REF);
    expect(startDate).toBe("2026-03-01");
    expect(endDate).toBe("2026-03-31");
  });

  it("last-month: returns full previous month", () => {
    const { startDate, endDate } = presetToDateRange("last-month", REF);
    expect(startDate).toBe("2026-02-01");
    expect(endDate).toBe("2026-02-28");
  });

  it("ytd: returns Jan 1 to today", () => {
    const { startDate, endDate } = presetToDateRange("ytd", REF);
    expect(startDate).toBe("2026-01-01");
    expect(endDate).toBe("2026-03-13");
  });

  it("unknown preset: returns 30d fallback", () => {
    const { startDate, endDate } = presetToDateRange("garbage", REF);
    expect(startDate).toBe("2026-02-12");
    expect(endDate).toBe("2026-03-13");
  });
});
