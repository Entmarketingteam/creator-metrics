import { formatCurrency } from "@/lib/utils";

interface CommissionsSummaryProps {
  pending: number;
  paid: number;
  total: number;
}

export default function CommissionsSummary({
  pending,
  paid,
  total,
}: CommissionsSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Pending */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-sm text-gray-400">Pending</p>
        <p className="mt-1 text-xl font-bold text-yellow-400">
          {formatCurrency(pending)}
        </p>
      </div>

      {/* Paid */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <p className="text-sm text-gray-400">Paid</p>
        <p className="mt-1 text-xl font-bold text-emerald-400">
          {formatCurrency(paid)}
        </p>
      </div>

      {/* Total */}
      <div className="rounded-xl border border-blue-800/30 bg-blue-500/5 p-4">
        <p className="text-sm text-gray-400">Total Earnings</p>
        <p className="mt-1 text-2xl font-bold text-white">
          {formatCurrency(total)}
        </p>
      </div>
    </div>
  );
}
