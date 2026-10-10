// Numbers for Level 2 answers, calculated in code so they are always right.
// The model gets these ready-made and only has to pick and explain them.
import type { BillFacts, Level1 } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole ? r2((part / whole) * 100) : null);

function daysBetween(a: string | null, b: string | null) {
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function sumBy<T>(items: T[], key: (t: T) => string, val: (t: T) => number) {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = r2((out[key(it)] ?? 0) + val(it));
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Last date printed in a late-payment label: "Upto 14/09/26", "Till 22-Apr-24-Apr", "After 12-OCT-26". */
function labelDate(label: string, year: number): number | null {
  const numeric = [...label.matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/g)].at(-1);
  if (numeric) {
    const y = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return Date.UTC(y, Number(numeric[2]) - 1, Number(numeric[1]));
  }
  const named = [...label.matchAll(/(\d{1,2})[\s-]*([A-Za-z]{3})[a-z]*(?:[\s-]*(\d{2,4})(?!\d*-?[A-Za-z]))?/g)].at(-1);
  if (named) {
    const m = MONTHS.indexOf(named[2].toLowerCase());
    if (m < 0) return null;
    const y = named[3] ? (Number(named[3]) < 100 ? 2000 + Number(named[3]) : Number(named[3])) : year;
    return Date.UTC(y, m, Number(named[1]));
  }
  return null;
}

/** Turns the printed late-payment labels into explicit date ranges after the due date. */
function lateSchedule(f: BillFacts, dueDate: string | null) {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const year = new Date(due).getUTCFullYear();
  const day = 86_400_000;
  const bands = f.late_payment_amounts
    .filter((a) => a.amount !== null)
    .map((a) => ({ label: a.label, amount: a.amount!, date: labelDate(a.label, year), after: /after/i.test(a.label) }))
    .sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity) || Number(a.after) - Number(b.after));
  if (!bands.length || bands.some((b) => b.date === null)) return null;
  let from = due + day;
  return bands.map((b) => {
    const start = b.after ? b.date! + day : from;
    const range = b.after ? { from: iso(start), to: "onwards" } : { from: iso(start), to: iso(b.date!) };
    const lateFrom = Math.round((start - due) / day);
    const lateTo = b.after ? null : Math.round((b.date! - due) / day);
    if (!b.after) from = b.date! + day;
    return {
      printed_label: b.label,
      pay_between: `${range.from} to ${range.to}`,
      days_late: lateTo === null ? `${lateFrom} or more days late` : `${lateFrom} to ${lateTo} days late`,
      amount: b.amount,
    };
  });
}

export function computeStats(l1: Level1, f: BillFacts) {
  const units = l1.units_consumed;
  const hist = f.usage_history.filter((h): h is { month: string; units: number } => h.units !== null);
  const histUnits = hist.map((h) => h.units);
  const histAvg = histUnits.length ? r2(histUnits.reduce((a, b) => a + b, 0) / histUnits.length) : null;
  const allUnits = units !== null ? [...histUnits, units] : histUnits;
  const allAvg = allUnits.length ? r2(allUnits.reduce((a, b) => a + b, 0) / allUnits.length) : null;
  const maxH = hist.length ? hist.reduce((a, b) => (b.units > a.units ? b : a)) : null;
  const minH = hist.length ? hist.reduce((a, b) => (b.units < a.units ? b : a)) : null;
  const prevMonth = hist.at(-1) ?? null;
  const billMonth = l1.bill_month;
  const sameMonthLastYear =
    billMonth && hist.find((h) => h.month === `${Number(billMonth.slice(0, 4)) - 1}${billMonth.slice(4)}`);

  const chargeSum = r2(l1.charges.reduce((s, c) => s + c.amount, 0));
  const taxSum = r2(l1.taxes.reduce((s, t) => s + t.amount, 0));
  const totalCharges = l1.total_charges ?? (l1.charges.length ? chargeSum : null);
  const totalTaxes = l1.total_taxes ?? (l1.taxes.length ? taxSum : null);
  const bill = l1.current_bill;
  const energy = r2(l1.charges.filter((c) => c.type === "energy").reduce((s, c) => s + c.amount, 0));

  return {
    units: {
      current_month_units: units,
      history_months_count: hist.length,
      history_months: hist.map((h) => `${monthName(h.month)}: ${h.units}`),
      history_average_excluding_current: histAvg,
      average_including_current: allAvg,
      history_total_units: histUnits.length ? histUnits.reduce((a, b) => a + b, 0) : null,
      highest_history_month: maxH ? `${monthName(maxH.month)} (${maxH.units} units)` : null,
      lowest_history_month: minH ? `${monthName(minH.month)} (${minH.units} units)` : null,
      current_vs_history_average:
        units !== null && histAvg !== null ? { difference_units: r2(units - histAvg), difference_percent: pct(units - histAvg, histAvg) } : null,
      current_vs_previous_month:
        units !== null && prevMonth ? { previous_month: monthName(prevMonth.month), previous_units: prevMonth.units, difference_units: units - prevMonth.units, difference_percent: pct(units - prevMonth.units, prevMonth.units) } : null,
      current_vs_same_month_last_year:
        units !== null && sameMonthLastYear ? { month: monthName(sameMonthLastYear.month), units: sameMonthLastYear.units, difference_units: units - sameMonthLastYear.units, difference_percent: pct(units - sameMonthLastYear.units, sameMonthLastYear.units) } : null,
      meter_reading_difference:
        l1.current_reading !== null && l1.previous_reading !== null ? r2(l1.current_reading - l1.previous_reading) : null,
    },
    money: {
      current_bill: bill,
      total_charges: totalCharges,
      total_taxes: totalTaxes,
      taxes_percent_of_current_bill: totalTaxes !== null && bill ? pct(totalTaxes, bill) : null,
      charges_percent_of_current_bill: totalCharges !== null && bill ? pct(totalCharges, bill) : null,
      taxes_as_percent_on_top_of_charges: totalTaxes !== null && totalCharges ? pct(totalTaxes, totalCharges) : null,
      charges_by_type: sumBy(l1.charges, (c) => c.type, (c) => c.amount),
      taxes_by_type: sumBy(l1.taxes, (t) => t.type, (t) => t.amount),
      charge_type_percent_of_current_bill: bill
        ? Object.fromEntries(Object.entries(sumBy(l1.charges, (c) => c.type, (c) => c.amount)).map(([k, v]) => [k, pct(v, bill)]))
        : null,
      energy_charges_total: energy,
      energy_cost_per_unit: units ? r2(energy / units) : null,
      average_cost_per_unit_current_bill: bill !== null && units ? r2(bill / units) : null,
      average_cost_per_unit_payable: l1.payable_within_due_date !== null && units ? r2(l1.payable_within_due_date / units) : null,
      arrears: l1.arrears,
      payable_within_due_date: l1.payable_within_due_date,
      payable_after_due_date: l1.payable_after_due_date,
      late_payment_extra:
        l1.payable_after_due_date !== null && l1.payable_within_due_date !== null ? r2(l1.payable_after_due_date - l1.payable_within_due_date) : null,
      late_payment_extra_percent:
        l1.payable_after_due_date !== null && l1.payable_within_due_date ? pct(l1.payable_after_due_date - l1.payable_within_due_date, l1.payable_within_due_date) : null,
      all_late_payment_amounts: f.late_payment_amounts,
      late_payment_schedule: lateSchedule(f, l1.due_date),
    },
    billing_history_check: f.billing_history.map((b) => ({
      month: monthName(b.month),
      billed: b.billed_amount,
      paid: b.payment_amount,
      payment_date: b.payment_date,
      status:
        b.payment_amount === null || b.payment_amount === 0
          ? "no payment shown"
          : b.billed_amount === null
            ? "payment shown, billed amount not shown"
            : Math.abs(b.payment_amount - b.billed_amount) <= 1
              ? "paid in full"
              : b.payment_amount > b.billed_amount
                ? `overpaid by ${r2(b.payment_amount - b.billed_amount)}`
                : `underpaid by ${r2(b.billed_amount - b.payment_amount)}`,
    })),
    dates: {
      days_from_issue_to_due: daysBetween(l1.issue_date, l1.due_date),
      days_from_reading_to_due: daysBetween(l1.reading_date, l1.due_date),
      days_from_reading_to_issue: daysBetween(l1.reading_date, l1.issue_date),
    },
  };
}
