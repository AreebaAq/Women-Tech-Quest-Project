"use client";

import { useState } from "react";
import type { DecodedBill, Level1 } from "@/lib/types";

const SUGGESTED = [
  "How much of my bill is taxes?",
  "How does this month's usage compare to my average?",
  "How much extra will I pay if I pay after the due date?",
  "If I use 20% fewer units next month, roughly what would my bill be?",
];

const pkr = (n: number | null) =>
  n === null ? "—" : `PKR ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const show = (v: string | number | null) => (v === null ? "—" : String(v));

function Summary({ l1 }: { l1: Level1 }) {
  const rows: [string, string][] = [
    ["Provider", show(l1.provider)],
    ["Tariff", show(l1.tariff)],
    ["Sanctioned load", l1.sanctioned_load_kw === null ? "—" : `${l1.sanctioned_load_kw} kW`],
    ["Bill month", show(l1.bill_month)],
    ["Reading / issue / due", `${show(l1.reading_date)} / ${show(l1.issue_date)} / ${show(l1.due_date)}`],
    ["Meter readings", `${show(l1.previous_reading)} → ${show(l1.current_reading)}`],
    ["Units consumed", show(l1.units_consumed)],
    ["Total charges", pkr(l1.total_charges)],
    ["Total taxes", pkr(l1.total_taxes)],
    ["Current bill", pkr(l1.current_bill)],
    ["Arrears", pkr(l1.arrears)],
    ["Payable by due date", pkr(l1.payable_within_due_date)],
    ["Payable after due date", pkr(l1.payable_after_due_date)],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <dl className="divide-y divide-black/10 rounded-xl border border-black/10 text-sm dark:divide-white/10 dark:border-white/15">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2">
            <dt className="opacity-60">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-4 text-sm">
        <LineTable title="Charges" lines={l1.charges} />
        <LineTable title="Taxes" lines={l1.taxes} />
      </div>
    </div>
  );
}

function LineTable({ title, lines }: { title: string; lines: { type: string; amount: number }[] }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/15">
      <h3 className="border-b border-black/10 px-3 py-2 font-semibold dark:border-white/10">{title}</h3>
      {lines.length === 0 ? (
        <p className="px-3 py-2 opacity-60">None listed separately</p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className="flex justify-between px-3 py-1.5">
            <span className="opacity-70">{l.type}</span>
            <span className="font-medium">{pkr(l.amount)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [bill, setBill] = useState<DecodedBill | null>(null);
  const [question, setQuestion] = useState("");
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState<"" | "decode" | "ask">("");
  const [error, setError] = useState("");
  const [showJson, setShowJson] = useState(false);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setBill(null);
    setQa([]);
    setError("");
  }

  async function decode() {
    if (!file) return;
    setBusy("decode");
    setError("");
    try {
      const form = new FormData();
      form.append("bill", file);
      const res = await fetch("/api/decode", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBill(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  async function ask(q: string) {
    if (!bill || !q.trim()) return;
    setBusy("ask");
    setError("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill, questions: [q] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQa((prev) => [{ q, a: data.answers[0] }, ...prev]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  const button =
    "rounded-lg bg-violet-600 px-5 py-2 font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-3xl font-bold">Utility Bill Decoder</h1>
      <p className="mt-1 text-sm opacity-60">
        Upload a K-Electric, LESCO or IESCO bill. Powered by Gemini 3.5 Flash-Lite.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-black/20 p-6 text-center hover:border-violet-500 dark:border-white/20">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <span className="font-medium">{file ? file.name : "Choose a bill image"}</span>
            <span className="text-sm opacity-60">PNG or JPG</span>
          </label>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Uploaded bill" className="mt-4 max-h-[70vh] w-full rounded-xl border border-black/10 object-contain dark:border-white/15" />
          )}
          <button className={`${button} mt-4 w-full`} onClick={decode} disabled={!file || busy !== ""}>
            {busy === "decode" ? "Reading the bill..." : "Decode bill"}
          </button>
        </section>

        <section className="space-y-6">
          {error && <p className="rounded-lg bg-red-500/10 p-3 text-red-600">{error}</p>}

          {bill && (
            <>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Level 1: Extracted details</h2>
                  <button className="text-sm text-violet-600 hover:underline" onClick={() => setShowJson((s) => !s)}>
                    {showJson ? "Show summary" : "Show JSON"}
                  </button>
                </div>
                {showJson ? (
                  <pre className="max-h-[60vh] overflow-auto rounded-xl bg-black/5 p-4 text-xs dark:bg-white/5">
                    {JSON.stringify(bill.level1, null, 2)}
                  </pre>
                ) : (
                  <Summary l1={bill.level1} />
                )}
                {bill.warnings.length > 0 && (
                  <ul className="mt-3 list-disc rounded-lg bg-amber-500/10 p-3 pl-7 text-sm text-amber-700 dark:text-amber-400">
                    {bill.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                )}
              </div>

              <div>
                <h2 className="mb-3 text-xl font-semibold">Level 2: Ask about this bill</h2>
                <div className="mb-3 flex flex-wrap gap-2">
                  {SUGGESTED.map((s) => (
                    <button key={s} className="rounded-full border border-black/15 px-3 py-1 text-sm hover:border-violet-500 disabled:opacity-50 dark:border-white/20" onClick={() => ask(s)} disabled={busy !== ""}>
                      {s}
                    </button>
                  ))}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
                  <input
                    className="flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
                    placeholder="Type your question..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <button className={button} disabled={busy !== "" || !question.trim()}>
                    {busy === "ask" ? "Thinking..." : "Ask"}
                  </button>
                </form>
                <div className="mt-4 space-y-3">
                  {qa.map(({ q, a }, i) => (
                    <div key={i} className="rounded-xl border border-black/10 p-4 dark:border-white/15">
                      <p className="font-medium">{q}</p>
                      <p className="mt-2 whitespace-pre-wrap opacity-80">{a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {!bill && !error && (
            <p className="rounded-xl border border-dashed border-black/15 p-6 text-center opacity-60 dark:border-white/20">
              Choose a bill and click Decode to see its details here.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
