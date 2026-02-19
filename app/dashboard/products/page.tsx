import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { products } from "@/lib/schema";
import { desc, sql } from "drizzle-orm";
import { Package } from "lucide-react";
import PlatformBadge from "@/components/earnings/PlatformBadge";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const allProducts = await db
    .select()
    .from(products)
    .orderBy(desc(sql`CAST(${products.totalRevenue} AS FLOAT)`))
    .limit(100);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Package className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Products</h1>
          <p className="text-gray-500">
            {allProducts.length} products tracked across platforms
          </p>
        </div>
      </div>

      {allProducts.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500">No product data yet. Products appear after n8n syncs earnings.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {allProducts.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden hover:border-gray-600 transition-colors"
            >
              {p.imageUrl && (
                <div className="aspect-video bg-gray-800 relative">
                  <img
                    src={p.imageUrl}
                    alt={p.productName}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <PlatformBadge platform={p.platform} />
                </div>
                <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2">
                  {p.productName}
                </h3>
                {p.brand && (
                  <p className="text-xs text-gray-400 mb-3">{p.brand}</p>
                )}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-800">
                  <div>
                    <p className="text-xs text-gray-500">Revenue</p>
                    <p className="text-sm font-bold text-white">
                      {formatCurrency(p.totalRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Clicks</p>
                    <p className="text-sm font-bold text-white">
                      {(p.totalClicks ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Sales</p>
                    <p className="text-sm font-bold text-white">
                      {(p.totalSales ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
