import { formatCurrency } from "@/lib/utils";

export interface MonthlyRow {
  month: string; // "YYYY-MM"
  ltk: number;
  shopmy: number;
  mavely: number;
  amazon: number;
  total: number;
}

const PLATFORM_COLS: { key: keyof Omit<MonthlyRow, "month" | "total">; label: string; color: string }[] = [
  { key: "ltk",    label: "LTK",    color: "text-amber-400" },
  { key: "shopmy", label: "ShopMy", color: "text-pink-400" },
  { key: "mavely", label: "Mavely", color: "text-purple-400" },
  { key: "amazon", label: "Amazon", color: "text-orange-400" },
];

function formatMonth(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function MonthlyBreakdown({ data }: { data: MonthlyRow[] }) {
  const grandTotal = data.reduce((s, r) => s + r.total, 0);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Monthly Breakdown</h2>
        <span className="text-xs text-gray-500">{formatCurrency(grandTotal)} total commission</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Month</th>
              {PLATFORM_COLS.map((c) => (
                <th key={c.key} className="text-right px-4 py-3 text-xs text-gray-500 font-medium">{c.label}</th>
              ))}
              <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.month} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-5 py-2.5 text-gray-300 font-medium">{formatMonth(row.month)}</td>
                {PLATFORM_COLS.map((c) => (
                  <td key={c.key} className="px-4 py-2.5 text-right">
                    {row[c.key] > 0
                      ? <span className={c.color}>{formatCurrency(row[c.key])}</span>
                      : <span className="text-gray-700">—</span>}
                  </td>
                ))}
                <td className="px-5 py-2.5 text-right font-semibold text-white">{formatCurrency(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
