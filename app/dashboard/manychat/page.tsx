"use client";

import { useState, useEffect } from "react";
import { MessageCircle, Plus, Copy, Check, ExternalLink, Trash2 } from "lucide-react";
import { CREATORS } from "@/lib/creators";

interface ShortLink {
  id: number;
  code: string;
  creator_id: string;
  keyword: string;
  affiliate_url: string;
  platform: string | null;
  created_at: string;
  clicks: number;
}

const PLATFORM_OPTIONS = [
  { label: "Mavely", value: "mavely" },
  { label: "LTK", value: "ltk" },
  { label: "ShopMy", value: "shopmy" },
  { label: "Amazon", value: "amazon" },
  { label: "Other", value: "other" },
];

const PLATFORM_COLORS: Record<string, string> = {
  mavely: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  ltk: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  shopmy: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  amazon: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  other: "bg-blue-500/20 text-blue-300 border-blue-500/30",
};

export default function ManyChatPage() {
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    creatorId: "nicki_entenmann",
    keyword: "",
    affiliateUrl: "",
    platform: "mavely",
  });

  const loadLinks = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/manychat-link");
    if (res.ok) setLinks(await res.json());
    setLoading(false);
  };

  useEffect(() => { loadLinks(); }, []);

  const createLink = async () => {
    if (!form.keyword || !form.affiliateUrl) return;
    setCreating(true);
    const res = await fetch("/api/admin/manychat-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const { shortUrl, code } = await res.json();
      setForm({ ...form, keyword: "", affiliateUrl: "" });
      setShowForm(false);
      await loadLinks();
      copyToClipboard(shortUrl, code);
    }
    setCreating(false);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const webhookUrl = "https://creator-metrics.vercel.app/api/webhooks/manychat";

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-6 h-6 text-orange-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">ManyChat Tracking</h1>
            <p className="text-gray-500 text-sm">Short links + event tracking for comment-trigger flows</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Link
        </button>
      </div>

      {/* Setup instructions */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Flow Setup Instructions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="space-y-2">
            <div className="text-orange-400 font-semibold">Step 1 — Create short link</div>
            <div className="text-gray-400">Click "New Link", paste the affiliate URL from your ManyChat DM, pick the keyword and creator. Copy the generated short URL.</div>
          </div>
          <div className="space-y-2">
            <div className="text-orange-400 font-semibold">Step 2 — Swap URL in flow</div>
            <div className="text-gray-400">In ManyChat, open the flow. Replace the affiliate URL in the DM button with the short URL you just copied.</div>
          </div>
          <div className="space-y-2">
            <div className="text-orange-400 font-semibold">Step 3 — Add External Requests</div>
            <div className="text-gray-400">Add two External Request steps: one at the trigger, one after the DM sends. Both POST to the webhook URL below.</div>
          </div>
        </div>

        {/* Webhook URL */}
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">Webhook URL (add to External Request steps)</div>
          <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
            <code className="text-xs text-green-400 flex-1">{webhookUrl}</code>
            <button
              onClick={() => copyToClipboard(webhookUrl, "webhook")}
              className="text-gray-500 hover:text-white transition-colors"
            >
              {copied === "webhook" ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-xs text-gray-600 mt-1">Header: <code className="text-gray-400">x-manychat-secret: [CRON_SECRET]</code> · Body fields: event_type, creator_id, keyword, flow_name, subscriber_ig, subscriber_id</div>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-gray-900 border border-orange-500/30 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">New Short Link</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Creator</label>
              <select
                value={form.creatorId}
                onChange={(e) => setForm({ ...form, creatorId: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {CREATORS.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Platform</label>
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Trigger Keyword</label>
              <input
                type="text"
                placeholder="SHOP"
                value={form.keyword}
                onChange={(e) => setForm({ ...form, keyword: e.target.value.toUpperCase() })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Affiliate URL (from ManyChat DM)</label>
              <input
                type="url"
                placeholder="https://go.mvly.co/..."
                value={form.affiliateUrl}
                onChange={(e) => setForm({ ...form, affiliateUrl: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={createLink}
              disabled={creating || !form.keyword || !form.affiliateUrl}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {creating ? "Creating..." : "Create & Copy URL"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Links table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Short Links</h2>
          <span className="text-xs text-gray-500">{links.length} total</span>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-gray-600 text-sm">Loading...</div>
        ) : links.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-600 text-sm">No links yet — create your first one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Keyword</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Creator</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Platform</th>
                <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Short URL</th>
                <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium">Clicks</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const shortUrl = `https://creator-metrics.vercel.app/r/${link.code}`;
                const creator = CREATORS.find((c) => c.id === link.creator_id);
                const platformColor = PLATFORM_COLORS[link.platform ?? "other"] ?? PLATFORM_COLORS.other;
                return (
                  <tr key={link.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <span className="bg-orange-500/20 text-orange-300 border border-orange-500/30 text-xs font-bold px-2 py-0.5 rounded-full">
                        💬 {link.keyword}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{creator?.displayName ?? link.creator_id}</td>
                    <td className="px-5 py-3">
                      {link.platform && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${platformColor}`}>
                          {link.platform}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-gray-400">/r/{link.code}</code>
                        <button
                          onClick={() => copyToClipboard(shortUrl, link.code)}
                          className="text-gray-600 hover:text-white transition-colors"
                          title="Copy short URL"
                        >
                          {copied === link.code ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <a
                          href={link.affiliate_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-600 hover:text-white transition-colors"
                          title="Open affiliate URL"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-semibold ${link.clicks > 0 ? "text-white" : "text-gray-600"}`}>
                        {link.clicks > 0 ? link.clicks.toLocaleString() : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button className="text-gray-700 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
