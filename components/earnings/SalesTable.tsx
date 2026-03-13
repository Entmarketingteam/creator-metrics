"use client";

import { useState, useMemo, useCallback } from "react";
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react";
import PlatformBadge from "./PlatformBadge";
import { formatCurrency } from "@/lib/utils";

interface Sale {
  id: number;
  platform: string;
  saleDate: string;
  productName: string | null;
  brand: string | null;
  commissionAmount: string | null;
  orderValue: string | null;
  status: string | null;
}

interface SalesTableProps {
  initialData: Sale[];
  totalCount: number;
}

const ITEMS_PER_PAGE = 20;

const PLATFORM_OPTIONS = ["All", "Mavely", "ShopMy", "LTK", "Amazon"];
const STATUS_OPTIONS = ["All", "Open", "Pending", "Paid", "Reversed"];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/10 text-blue-400",
  pending: "bg-yellow-500/10 text-yellow-400",
  paid: "bg-emerald-500/10 text-emerald-400",
  reversed: "bg-red-500/10 text-red-400",
};

export default function SalesTable({ initialData, totalCount }: SalesTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredData = useMemo(() => {
    let result = initialData;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (sale) =>
          (sale.productName && sale.productName.toLowerCase().includes(lower)) ||
          (sale.brand && sale.brand.toLowerCase().includes(lower))
      );
    }

    if (platformFilter !== "All") {
      result = result.filter(
        (sale) =>
          sale.platform.toLowerCase() === platformFilter.toLowerCase()
      );
    }

    if (statusFilter !== "All") {
      result = result.filter(
        (sale) =>
          sale.status &&
          sale.status.toLowerCase() === statusFilter.toLowerCase()
      );
    }

    return result;
  }, [initialData, searchTerm, platformFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / ITEMS_PER_PAGE));

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
      setCurrentPage(1);
    },
    []
  );

  const handlePlatformChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setPlatformFilter(e.target.value);
      setCurrentPage(1);
    },
    []
  );

  const handleStatusChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setStatusFilter(e.target.value);
      setCurrentPage(1);
    },
    []
  );

  const exportCSV = useCallback(() => {
    const headers = [
      "Date",
      "Platform",
      "Product",
      "Brand",
      "Status",
      "Commission",
      "Order Value",
    ];
    const rows = filteredData.map((sale) => [
      sale.saleDate,
      sale.platform,
      sale.productName ?? "",
      sale.brand ?? "",
      sale.status ?? "",
      sale.commissionAmount ?? "",
      sale.orderValue ?? "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-export-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredData]);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-gray-800 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search product or brand..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full rounded-lg border border-gray-800 bg-gray-950 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-700 focus:ring-1 focus:ring-gray-700"
            />
          </div>

          {/* Platform filter */}
          <select
            value={platformFilter}
            onChange={handlePlatformChange}
            className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 outline-none focus:border-gray-700"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={handleStatusChange}
            className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 outline-none focus:border-gray-700"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        {/* Export */}
        <button
          onClick={exportCSV}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-400">
                Date
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-400">
                Platform
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-400">
                Product
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-400">
                Brand
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-gray-400">
                Status
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-400">
                Commission
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  No sales found.
                </td>
              </tr>
            ) : (
              paginatedData.map((sale) => {
                const statusKey = (sale.status ?? "").toLowerCase();
                const statusColor =
                  STATUS_COLORS[statusKey] ?? "bg-gray-500/10 text-gray-400";

                return (
                  <tr
                    key={sale.id}
                    className="transition-colors hover:bg-gray-800/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-300">
                      {formatDate(sale.saleDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <PlatformBadge platform={sale.platform} />
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-white">
                      {sale.productName ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-300">
                      {sale.brand ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {sale.status ? (
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusColor}`}
                        >
                          {sale.status.charAt(0).toUpperCase() +
                            sale.status.slice(1).toLowerCase()}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-white">
                      {formatCurrency(sale.commissionAmount)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-gray-800 px-4 py-3">
        <p className="text-sm text-gray-400">
          Showing{" "}
          <span className="font-medium text-white">
            {filteredData.length === 0
              ? 0
              : (currentPage - 1) * ITEMS_PER_PAGE + 1}
          </span>
          {" - "}
          <span className="font-medium text-white">
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredData.length)}
          </span>{" "}
          of{" "}
          <span className="font-medium text-white">{filteredData.length}</span>
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-800 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <span className="text-sm text-gray-500">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-800 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
