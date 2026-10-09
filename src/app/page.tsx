"use client";

import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError("");
    setReply("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReply(data.reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <h1 className="text-3xl font-bold">Women Tech Quest 2026</h1>
      <p className="mt-1 text-sm opacity-60">Powered by Gemini 3.5 Flash-Lite</p>

      <textarea
        className="mt-8 h-32 w-full rounded-lg border border-black/15 bg-transparent p-3 dark:border-white/20"
        placeholder="Ask something..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button
        className="mt-3 rounded-lg bg-violet-600 px-5 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        onClick={send}
        disabled={loading || !prompt.trim()}
      >
        {loading ? "Thinking..." : "Send"}
      </button>

      {error && (
        <p className="mt-6 rounded-lg bg-red-500/10 p-3 text-red-600">{error}</p>
      )}
      {reply && (
        <div className="mt-6 whitespace-pre-wrap rounded-lg border border-black/10 p-4 dark:border-white/15">
          {reply}
        </div>
      )}
    </main>
  );
}
