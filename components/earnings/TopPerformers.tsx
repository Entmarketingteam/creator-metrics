"use client";

import PlatformBadge from "./PlatformBadge";
import { formatCurrency, formatNumber } from "@/lib/utils";

interface Product {
  id: number;
  productName: string;
  brand: string | null;
  platform: string;
  totalRevenue: string | null;
  totalClicks: number | null;
  totalSales: number | null;
  imageUrl: string | null;
}

interface TopPerformersProps {
  products: Product[];
}

export default function TopPerformers({ products }: TopPerformersProps) {
  const topFive = products.slice(0, 5);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-400">
        Top Performers
      </h3>

      {topFive.length === 0 ? (
        <p className="text-sm text-gray-500">No product data yet.</p>
      ) : (
        <div className="space-y-3">
          {topFive.map((product, index) => (
            <div
              key={product.id}
              className="flex items-center gap-3 rounded-lg border border-gray-800/50 bg-gray-950/50 p-3 transition-colors hover:bg-gray-800/30"
            >
              {/* Rank */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">
                {index + 1}
              </span>

              {/* Image or placeholder */}
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.productName}
                  className="h-10 w-10 shrink-0 rounded-lg border border-gray-800 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-gray-800/50">
                  <span className="text-xs text-gray-500">N/A</span>
                </div>
              )}

              {/* Details */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {product.productName}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  {product.brand && (
                    <span className="text-xs text-gray-500">
                      {product.brand}
                    </span>
                  )}
                  <PlatformBadge platform={product.platform} />
                </div>
              </div>

              {/* Stats */}
              <div className="flex shrink-0 items-center gap-4 text-right">
                <div>
                  <p className="text-sm font-bold text-white">
                    {formatCurrency(product.totalRevenue)}
                  </p>
                  <p className="text-xs text-gray-500">revenue</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-gray-300">
                    {formatNumber(product.totalClicks)}
                  </p>
                  <p className="text-xs text-gray-500">clicks</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-gray-300">
                    {formatNumber(product.totalSales)}
                  </p>
                  <p className="text-xs text-gray-500">sales</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
