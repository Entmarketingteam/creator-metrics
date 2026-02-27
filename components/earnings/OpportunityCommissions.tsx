import { formatCurrency } from "@/lib/utils";

interface OpportunityCommission {
  id: number;
  title: string | null;
  commissionAmount: string | null;
  status: string | null;
}

interface OpportunityCommissionsProps {
  data: OpportunityCommission[];
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-400",
  pending: "bg-yellow-500/10 text-yellow-400",
  active: "bg-blue-500/10 text-blue-400",
  cancelled: "bg-red-500/10 text-red-400",
};

export default function OpportunityCommissions({ data }: OpportunityCommissionsProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 text-center text-sm text-gray-500">
        No opportunity commissions found.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Opportunity Commissions</h3>
        <p className="text-xs text-gray-500 mt-0.5">Brand partnership flat-rate deals</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="px-4 py-3 font-medium text-gray-400">Campaign</th>
              <th className="px-4 py-3 font-medium text-gray-400">Status</th>
              <th className="px-4 py-3 text-right font-medium text-gray-400">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {data.map((item) => {
              const statusKey = (item.status ?? "").toLowerCase();
              const statusColor =
                STATUS_COLORS[statusKey] ?? "bg-gray-500/10 text-gray-400";

              return (
                <tr key={item.id} className="transition-colors hover:bg-gray-800/30">
                  <td className="max-w-[300px] truncate px-4 py-3 text-white">
                    {item.title ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {item.status ? (
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusColor}`}
                      >
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-white">
                    {formatCurrency(item.commissionAmount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
