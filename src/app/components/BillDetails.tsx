"use client";

import { useState } from "react";
import type { DecodedBill, Level1 } from "@/lib/types";

export const pkr = (n: number | null) =>
  n === null ? "—" : `Rs ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const show = (v: string | number | null) => (v === null ? "—" : String(v));

const LABELS: Record<string, string> = {
  energy: "Energy",
  fixed: "Fixed charges",
  fpa: "Fuel price adjustment",
  quarterly_adjustment: "Quarterly adjustment",
  surcharge: "Surcharge",
  meter_rent: "Meter rent",
  subsidy: "Subsidy",
  other: "Other",
  gst: "Sales tax (GST)",
  electricity_duty: "Electricity duty",
  income_tax: "Income tax",
  municipal_tax: "Municipal tax",
  other_tax: "Other tax",
};

function monthLabel(ym: string | null) {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function KeyFigures({ l1 }: { l1: Level1 }) {
  const tiles = [
    { label: "Payable by due date", value: pkr(l1.payable_within_due_date), sub: l1.due_date ? `Due ${l1.due_date}` : "Due date not shown", accent: true },
    { label: "Units consumed", value: show(l1.units_consumed), sub: monthLabel(l1.bill_month) },
    { label: "This month's bill", value: pkr(l1.current_bill), sub: l1.payable_after_due_date !== null ? `${pkr(l1.payable_after_due_date)} after due date` : "No late amount shown" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`rounded-2xl p-4 ${t.accent ? "bg-violet-700 text-white shadow-lg shadow-violet-700/20" : "border border-black/8 bg-white dark:border-white/10 dark:bg-white/5"}`}
        >
          <p className={`text-xs font-medium uppercase tracking-wide ${t.accent ? "text-violet-200" : "opacity-55"}`}>{t.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{t.value}</p>
          <p className={`mt-0.5 text-xs ${t.accent ? "text-violet-200" : "opacity-55"}`}>{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="opacity-60">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  );
}

function Summary({ l1 }: { l1: Level1 }) {
  return (
    <dl className="divide-y divide-black/6 dark:divide-white/8">
      <Row k="Provider" v={show(l1.provider)} />
      <Row k="Tariff" v={show(l1.tariff)} />
      <Row k="Sanctioned load" v={l1.sanctioned_load_kw === null ? "—" : `${l1.sanctioned_load_kw} kW`} />
      <Row k="Bill month" v={monthLabel(l1.bill_month)} />
      <Row k="Reading date" v={show(l1.reading_date)} />
      <Row k="Issue date" v={show(l1.issue_date)} />
      <Row k="Due date" v={show(l1.due_date)} />
      <Row k="Meter readings" v={`${show(l1.previous_reading)} → ${show(l1.current_reading)}`} />
      <Row k="Arrears" v={pkr(l1.arrears)} />
      <Row k="Payable after due date" v={pkr(l1.payable_after_due_date)} />
    </dl>
  );
}

function Lines({ title, lines, total }: { title: string; lines: { type: string; amount: number }[]; total: number | null }) {
  return (
    <div>
      <h4 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">{title}</h4>
      {lines.length === 0 && <p className="px-4 py-2 text-sm opacity-55">Not itemised on this bill</p>}
      <dl>
        {lines.map((l, i) => (
          <Row key={i} k={LABELS[l.type] ?? l.type} v={pkr(l.amount)} />
        ))}
      </dl>
      <div className="mx-4 flex justify-between border-t border-black/10 py-2.5 text-sm font-semibold dark:border-white/15">
        <span>Total {title.toLowerCase()}</span>
        <span className="tabular-nums">{pkr(total)}</span>
      </div>
    </div>
  );
}

const TABS = ["Summary", "Charges & taxes", "JSON"] as const;

export function BillDetails({ bill }: { bill: DecodedBill }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Summary");
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(bill.level1, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(bill.level1));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the JSON is still visible to select by hand.
    }
  }

  return (
    <div className="space-y-4">
      <KeyFigures l1={bill.level1} />

      {bill.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <p className="font-medium">Some values may need a second look:</p>
          <ul className="mt-1 list-disc pl-5">{bill.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-black/8 bg-white dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center gap-1 border-b border-black/8 px-2 dark:border-white/10" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium transition-colors ${tab === t ? "border-violet-700 text-violet-700 dark:border-violet-300 dark:text-violet-300" : "border-transparent opacity-60 hover:opacity-100"}`}
            >
              {t}
            </button>
          ))}
          {tab === "JSON" && (
            <button onClick={copy} className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-700/10 dark:text-violet-300">
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        {tab === "Summary" && <Summary l1={bill.level1} />}
        {tab === "Charges & taxes" && (
          <div className="pb-2">
            <Lines title="Charges" lines={bill.level1.charges} total={bill.level1.total_charges} />
            <Lines title="Taxes" lines={bill.level1.taxes} total={bill.level1.total_taxes} />
          </div>
        )}
        {tab === "JSON" && <pre className="max-h-[28rem] overflow-auto p-4 font-mono text-xs leading-relaxed">{json}</pre>}
      </div>
    </div>
  );
}
