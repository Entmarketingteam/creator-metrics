"use client";
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

export function InsightsChat({ creatorId }: { creatorId: string }) {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/intelligence/ask",
      body: { creatorId },
    }),
  });
  const [input, setInput] = useState("");
  const isLoading = status === "streaming" || status === "submitted";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="bg-gray-900 px-5 py-3 border-b border-gray-800">
        <h2 className="text-white font-semibold text-sm">Ask About This Creator</h2>
      </div>

      <div className="p-5 space-y-4 min-h-[120px] max-h-[400px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-gray-600 text-sm">Ask anything — "Why do her Reels outperform feed posts?" or "What topics drive the most saves?"</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`text-sm ${m.role === "user" ? "text-blue-400" : "text-gray-300"}`}>
            <span className="font-medium mr-2">{m.role === "user" ? "You:" : "AI:"}</span>
            {m.parts?.map((part: any, i: number) =>
              part.type === "text" ? <span key={i}>{part.text}</span> : null
            )}
          </div>
        ))}
        {isLoading && <p className="text-gray-500 text-sm animate-pulse">Thinking…</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3 p-4 border-t border-gray-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this creator's content…"
          className="flex-1 bg-gray-800 text-white placeholder-gray-500 rounded-lg px-4 py-2.5 text-sm border border-gray-700 focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
