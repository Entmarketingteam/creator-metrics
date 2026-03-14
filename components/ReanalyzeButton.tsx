"use client";
import { useState } from "react";

export function ReanalyzeButton({ creatorId }: { creatorId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const handleClick = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/intelligence/caption-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId }),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("done");
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  };

  const labels: Record<typeof status, string> = {
    idle:    "Re-analyze Captions",
    loading: "Queuing...",
    done:    "✓ Queued",
    error:   "Error — retry?",
  };

  return (
    <button
      onClick={handleClick}
      disabled={status === "loading"}
      className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
    >
      {labels[status]}
    </button>
  );
}
