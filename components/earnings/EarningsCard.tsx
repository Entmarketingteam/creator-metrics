import { ArrowRight, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface EarningsCardProps {
  totalRevenue: number;
  pendingPayment: number;
  period: string;
}

export default function EarningsCard({
  totalRevenue,
  pendingPayment,
  period,
}: EarningsCardProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-400">Earnings</h3>
          <p className="text-xs text-gray-500">Last {period}</p>
        </div>
        <Info className="h-4 w-4 text-gray-600" />
      </div>

      <p className="mt-3 text-2xl font-bold text-white">
        {formatCurrency(totalRevenue)}
      </p>

      {pendingPayment > 0 && (
        <p className="mt-1 text-sm text-yellow-400">
          {formatCurrency(pendingPayment)} pending
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-3">
        <span className="text-sm text-gray-400">Commissions</span>
        <a
          href="#commissions"
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
        >
          {formatCurrency(totalRevenue)}
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
