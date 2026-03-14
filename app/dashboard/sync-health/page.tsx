import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

const PLATFORMS = ["amazon", "ltk", "shopmy", "mavely"] as const;

type PlatformHealth = {
  last_sync: string | null;
  status: "ok" | "stale" | "never_synced";
  months_count: number;
  daily_count?: number;
  gap_days: number | null;
};

type CreatorHealth = {
  id: string;
  display_name: string;
  platforms: Record<string, PlatformHealth>;
};

type Alert = {
  creator_id: string;
  platform: string;
  severity: "warning" | "error";
  message: string;
};

type SyncHealthResponse = {
  creators: CreatorHealth[];
  alerts: Alert[];
  generated_at: string;
};

function StatusDot({ status }: { status: "ok" | "stale" | "never_synced" }) {
  if (status === "ok") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" title="OK" />;
  }
  if (status === "stale") {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" title="Stale" />;
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" title="Never synced" />;
}

function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getSyncHealth(): Promise<SyncHealthResponse | null> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/admin/sync-health`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function SyncHealthPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const data = await getSyncHealth();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Activity className="w-6 h-6 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Sync Health</h1>
          <p className="text-gray-500 text-sm">
            Platform data freshness per creator
            {data?.generated_at && (
              <> — checked {formatLastSync(data.generated_at)}</>
            )}
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 mb-6 text-sm text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />
          OK
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
          Stale (&gt;2 days)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
          Never synced
        </span>
      </div>

      {!data ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-500">
          Failed to load sync health data.
        </div>
      ) : (
        <>
          {/* Health Table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left p-3 text-gray-400 font-medium">Creator</th>
                  {PLATFORMS.map((p) => (
                    <th key={p} className="text-left p-3 text-gray-400 font-medium capitalize">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.creators.map((creator) => (
                  <tr key={creator.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-white font-medium">{creator.display_name}</td>
                    {PLATFORMS.map((platform) => {
                      const ph = creator.platforms[platform];
                      if (!ph) {
                        return (
                          <td key={platform} className="p-3 text-gray-600">—</td>
                        );
                      }
                      return (
                        <td key={platform} className="p-3">
                          <div className="flex items-center gap-2">
                            <StatusDot status={ph.status} />
                            <div>
                              <div className="text-gray-300 text-xs">{formatLastSync(ph.last_sync)}</div>
                              <div className="text-gray-600 text-xs">
                                {ph.months_count > 0 && `${ph.months_count}mo`}
                                {platform === "amazon" && ph.daily_count !== undefined && (
                                  <> · {ph.daily_count}d</>
                                )}
                                {ph.gap_days !== null && ph.gap_days > 0 && (
                                  <> · {ph.gap_days}d ago</>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {data.creators.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      No creators found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-3">
                Alerts ({data.alerts.length})
              </h2>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left p-3 text-gray-400 font-medium">Creator</th>
                      <th className="text-left p-3 text-gray-400 font-medium">Platform</th>
                      <th className="text-left p-3 text-gray-400 font-medium">Severity</th>
                      <th className="text-left p-3 text-gray-400 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.alerts.map((alert, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="p-3 text-white">
                          {data.creators.find((c) => c.id === alert.creator_id)?.display_name ||
                            alert.creator_id}
                        </td>
                        <td className="p-3 text-gray-400 capitalize">{alert.platform}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              alert.severity === "error"
                                ? "bg-red-500/10 text-red-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {alert.severity}
                          </span>
                        </td>
                        <td className="p-3 text-gray-400">{alert.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.alerts.length === 0 && (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-900/10 p-4 text-emerald-400 text-sm text-center">
              All platforms synced within the last 2 days — no alerts.
            </div>
          )}
        </>
      )}
    </div>
  );
}
