"use client";

import { useState } from "react";
import type { DecodedBill } from "@/lib/types";
import { AskPanel } from "./components/AskPanel";
import { BillDetails } from "./components/BillDetails";

const STEPS = ["Upload bill", "Extract details", "Ask questions"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                state === "todo" ? "border border-black/15 opacity-50 dark:border-white/20" : "bg-violet-700 text-white"
              }`}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className={state === "todo" ? "opacity-50" : "font-medium"}>{s}</span>
            {i < STEPS.length - 1 && <span className="hidden h-px w-8 bg-black/15 sm:block dark:bg-white/20" />}
          </li>
        );
      })}
    </ol>
  );
}

function Bolt() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
    </svg>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [bill, setBill] = useState<DecodedBill | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file (PNG or JPG).");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setBill(null);
    setError("");
  }

  async function decode() {
    if (!file) return;
    setDecoding(true);
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
      setDecoding(false);
    }
  }

  const step = bill ? 2 : file ? 1 : 0;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-black/8 bg-white/70 backdrop-blur dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-violet-700 text-white"><Bolt /></span>
            <div>
              <p className="font-bold leading-tight">Utility Bill Decoder</p>
              <p className="text-xs opacity-55">K-Electric · LESCO · IESCO</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-violet-700/10 px-3 py-1 text-violet-800 dark:text-violet-200">WTQ 2026 · Build Track</span>
            <span className="rounded-full border border-black/10 px-3 py-1 opacity-70 dark:border-white/15">Gemini 3.5 Flash-Lite</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="mb-8 space-y-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Understand your electricity bill</h1>
            <p className="mt-2 max-w-2xl opacity-65">
              Upload a photo or scan of your bill. We read the charges, taxes and amounts due, then answer your questions in plain English.
            </p>
          </div>
          <Steps current={step} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="space-y-4">
            <label
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? "border-violet-600 bg-violet-700/5" : "border-black/15 hover:border-violet-500 dark:border-white/20"
              }`}
            >
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              <span className="font-semibold">{file ? file.name : "Drop your bill here or click to choose"}</span>
              <span className="text-sm opacity-55">{file ? "Click to choose a different bill" : "PNG or JPG, up to 10 MB"}</span>
            </label>

            {preview && (
              <div className="overflow-hidden rounded-2xl border border-black/8 bg-white dark:border-white/10 dark:bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Uploaded electricity bill" className="max-h-[65vh] w-full object-contain" />
              </div>
            )}

            <button
              onClick={decode}
              disabled={!file || decoding}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-700/20 transition-colors hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {decoding && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {decoding ? "Reading your bill..." : bill ? "Decode again" : "Decode bill"}
            </button>
            <p className="text-center text-xs opacity-50">Names, addresses and ID numbers are never extracted.</p>
          </section>

          <section className="space-y-6">
            {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

            {decoding && (
              <div className="space-y-4" aria-label="Reading the bill">
                <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24" />)}</div>
                <div className="skeleton h-72" />
                <p className="text-center text-sm opacity-55">Reading your bill. This usually takes 10–20 seconds.</p>
              </div>
            )}

            {bill && !decoding && (
              <>
                <BillDetails bill={bill} />
                <AskPanel key={bill.billId + bill.level1.current_bill} bill={bill} />
              </>
            )}

            {!bill && !decoding && (
              <div className="grid h-full min-h-72 place-items-center rounded-2xl border border-dashed border-black/12 p-8 text-center dark:border-white/15">
                <div className="max-w-sm space-y-2">
                  <p className="font-semibold">Your bill details will appear here</p>
                  <p className="text-sm opacity-60">
                    Amount due, units used, every charge and tax line, and the full JSON. Then ask questions like
                    “How much of my bill is taxes?”
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="border-t border-black/8 py-4 text-center text-xs opacity-55 dark:border-white/10">
        Built for Women Tech Quest 2026 · Model: Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)
      </footer>
    </div>
  );
}
