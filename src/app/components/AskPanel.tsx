"use client";

import { useState } from "react";
import type { DecodedBill } from "@/lib/types";

const SUGGESTED = [
  "How much of my bill is taxes?",
  "How does this month compare to my average usage?",
  "How much extra will I pay if I pay late?",
  "If I use 20% fewer units, roughly what would my bill be?",
];

export function AskPanel({ bill }: { bill: DecodedBill }) {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<{ q: string; a?: string; error?: string }[]>([]);
  const busy = thread.some((t) => t.a === undefined && t.error === undefined);

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    setQuestion("");
    setThread((prev) => [...prev, { q }]);
    const update = (patch: { a?: string; error?: string }) =>
      setThread((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, ...patch } : t)));
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill, questions: [q] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      update({ a: data.answers[0] });
    } catch (err) {
      update({ error: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4 dark:border-white/10 dark:bg-white/5 sm:p-5">
      <h3 className="font-semibold">Ask about this bill</h3>
      <p className="text-sm opacity-60">Answers use only what is printed on your bill. Calculations are done in code.</p>

      <div className="mt-4 space-y-3">
        {thread.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-violet-700 px-4 py-2 text-sm text-white">{t.q}</p>
            {t.a !== undefined && (
              <p className="w-fit max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-violet-700/8 px-4 py-2.5 text-sm leading-relaxed dark:bg-white/8">{t.a}</p>
            )}
            {t.error && <p className="w-fit rounded-2xl bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">{t.error}</p>}
            {t.a === undefined && !t.error && (
              <div className="w-2/3 space-y-2 rounded-2xl bg-violet-700/5 p-3" aria-label="Thinking">
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-4/5" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTED.map((s) => (
          <button
            key={s}
            onClick={() => ask(s)}
            disabled={busy}
            className="rounded-full border border-violet-700/25 px-3 py-1.5 text-xs font-medium text-violet-800 transition-colors hover:bg-violet-700/8 disabled:opacity-40 dark:text-violet-200"
          >
            {s}
          </button>
        ))}
      </div>

      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <input
          className="min-w-0 flex-1 rounded-xl border border-black/12 bg-transparent px-4 py-2.5 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/20 dark:border-white/15"
          placeholder="Ask anything about your bill..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-800 disabled:opacity-40"
          disabled={busy || !question.trim()}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
