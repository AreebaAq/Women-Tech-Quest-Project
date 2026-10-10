"use client";

import { useEffect, useRef, useState } from "react";
import type { DecodedBill } from "@/lib/types";

const SUGGESTED = [
  "How much of my bill is taxes?",
  "How does this month compare to my average usage?",
  "How much extra will I pay if I pay late?",
  "If I use 20% fewer units, roughly what would my bill be?",
];

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
    </svg>
  );
}

export function AskPanel({ bill }: { bill: DecodedBill }) {
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<{ q: string; a?: string; error?: string }[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = thread.some((t) => t.a === undefined && t.error === undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread]);

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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-2.5 border-b border-black/8 px-4 py-3 dark:border-white/10">
        <span className="grid size-8 place-items-center rounded-lg bg-violet-700/10 text-violet-700 dark:text-violet-300"><Sparkle /></span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Ask about this bill</h3>
          <p className="text-xs opacity-55">Answers use only what is printed on your bill</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {thread.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm opacity-60">Try one of these:</p>
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="block w-full rounded-xl border border-violet-700/20 px-3 py-2.5 text-left text-sm text-violet-900 transition-colors hover:border-violet-600 hover:bg-violet-700/5 dark:text-violet-100"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {thread.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-sm bg-violet-700 px-3.5 py-2 text-sm text-white">{t.q}</p>
            {t.a !== undefined && (
              <p className="w-fit max-w-[94%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-violet-700/8 px-3.5 py-2.5 text-sm leading-relaxed dark:bg-white/8">{t.a}</p>
            )}
            {t.error && <p className="w-fit rounded-2xl bg-red-500/10 px-3.5 py-2 text-sm text-red-600 dark:text-red-400">{t.error}</p>}
            {t.a === undefined && !t.error && (
              <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-bl-sm bg-violet-700/8 px-4 py-3" aria-label="Thinking">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="size-1.5 animate-bounce rounded-full bg-violet-700/60" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {thread.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-2">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              disabled={busy}
              className="shrink-0 rounded-full border border-violet-700/20 px-3 py-1 text-xs text-violet-900 hover:bg-violet-700/5 disabled:opacity-40 dark:text-violet-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="flex gap-2 border-t border-black/8 p-3 dark:border-white/10" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
        <input
          className="min-w-0 flex-1 rounded-xl border border-black/12 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/20 dark:border-white/15"
          placeholder="Ask anything about your bill..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-800 disabled:opacity-40"
          disabled={busy || !question.trim()}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
