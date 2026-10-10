// Level 1: read a bill image with the model, then clean and check the result in code.
// The model only reads what is printed. Code applies the guide's fixed rules
// (provider from file name, highest late amount, skip zero lines, signs, formats).
import { Type, MediaResolution, type Schema } from "@google/genai";
import { generate, parseJson } from "./llm";
import { CHARGE_TYPES, TAX_TYPES, type BillFacts, type BillLine, type ChargeType, type DecodedBill, type Level1, type TaxType } from "./types";

const num = { type: Type.NUMBER, nullable: true };
const str = { type: Type.STRING, nullable: true };

const FACTS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    provider_printed: { ...str, description: "Company name as printed: K-Electric, LESCO or IESCO" },
    tariff: { ...str, description: "Tariff code exactly as printed, e.g. A1-R or A-1a(01)" },
    sanctioned_load_kw: { ...num, description: "Sanc Load / S.Load / San Load in kW" },
    bill_month: { ...str, description: "YYYY-MM" },
    reading_date: { ...str, description: "YYYY-MM-DD" },
    issue_date: { ...str, description: "YYYY-MM-DD" },
    due_date: { ...str, description: "YYYY-MM-DD, last date to pay without late surcharge" },
    previous_reading: num,
    current_reading: num,
    units_consumed: { ...num, description: "Total units billed for the current month as printed (e.g. 'Current Month 901 units' or the UNITS column), not one peak/off-peak row" },
    lines: {
      type: Type.ARRAY,
      description: "Every printed line of the charges section and of the taxes/government section, in printed order",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING, description: "Line label as printed, translated to English if in Urdu" },
          section: { type: Type.STRING, enum: ["charges", "taxes"] },
          type: { type: Type.STRING, enum: [...CHARGE_TYPES, ...TAX_TYPES] },
          units: num,
          rate: num,
          amount: { ...num, description: "Printed amount in PKR. Credits (CR) and subsidies negative" },
        },
        required: ["label", "section", "type", "amount"],
        propertyOrdering: ["label", "section", "type", "units", "rate", "amount"],
      },
    },
    total_charges: { ...num, description: "Printed charges subtotal, null if none printed" },
    total_taxes: { ...num, description: "Printed taxes subtotal, null if none printed" },
    current_bill: { ...num, description: "Printed amount for this month's bill" },
    arrears: { ...num, description: "Previous dues / arrears with printed sign, null if blank" },
    payable_within_due_date: num,
    late_payment_amounts: {
      type: Type.ARRAY,
      description: "Every printed TOTAL amount payable after the due date (not the surcharge amount alone)",
      items: {
        type: Type.OBJECT,
        properties: { label: { type: Type.STRING }, amount: num },
        required: ["label", "amount"],
      },
    },
    usage_history: {
      type: Type.ARRAY,
      description: "Monthly units from the usage history table/chart, oldest first. Exclude the current month",
      items: {
        type: Type.OBJECT,
        properties: { month: { type: Type.STRING, description: "YYYY-MM" }, units: num },
        required: ["month", "units"],
      },
    },
    billing_history: {
      type: Type.ARRAY,
      description: "Billing/payment history rows, if printed",
      items: {
        type: Type.OBJECT,
        properties: {
          month: { type: Type.STRING, description: "YYYY-MM" },
          billed_amount: num,
          payment_amount: num,
          payment_date: { ...str, description: "YYYY-MM-DD" },
        },
        required: ["month"],
      },
    },
    other_details: {
      type: Type.ARRAY,
      description: "Other useful non-personal printed facts in English: percentage splits, MDI, connected load, number of months billed, peak/off-peak units, subsidy notes, message board notices, etc.",
      items: {
        type: Type.OBJECT,
        properties: { label: { type: Type.STRING }, value: { type: Type.STRING } },
        required: ["label", "value"],
      },
    },
    reading_notes: { ...str, description: "Short note on any values that were hard to read or covered" },
  },
  required: [
    "provider_printed", "tariff", "sanctioned_load_kw", "bill_month", "reading_date", "issue_date", "due_date",
    "previous_reading", "current_reading", "units_consumed", "lines", "total_charges", "total_taxes",
    "current_bill", "arrears", "payable_within_due_date", "late_payment_amounts", "usage_history",
    "billing_history", "other_details", "reading_notes",
  ],
};

const EXTRACTION_PROMPT = `You read Pakistani electricity bills (K-Electric, LESCO, IESCO) and transcribe them into JSON.
The bill may be scanned, tilted, or partly in Urdu. Names, addresses and ID numbers are covered with grey boxes.

Rules:
- Transcribe values exactly as printed. Never recalculate, round, or correct amounts.
- Amounts are plain numbers in PKR: "Rs. 19,964" -> 19964. A credit like "38209CR" -> -38209. Subsidy/relief lines are negative.
- Dates: "22nd Sep 2026" -> "2026-09-22", "07-Apr-2026" -> "2026-04-07". Bill month "MAR 2026" or "Apr-26" -> "2026-03" / "2026-04".
- Watch for "CR" after amounts everywhere, including payable amounts: "54770CR" -> -54770.
- If the meter table has several rows (net metering), use the readings of the row whose units equal the billed units, usually the first row.
  If no single row matches the billed units, use null for previous_reading and current_reading.
- Use null for anything not printed, blank, covered by a grey box, or unreadable. Do not guess.
- Never output names, addresses, CNIC, account, reference, consumer or meter numbers.
- lines: one entry per printed line in the charges section, and one per line in the tax/government section.
  The printed SECTION decides "charges" vs "taxes", not the line's name. Include lines printed as 0 too (code removes them).
  Do not include subtotals, opening balance, payments, previous dues, or late payment surcharge lines as lines.
  Charge types: energy (cost of units, "Variable Upto ... Units", "Cost of Electricity", "Energy Charges"), fixed,
  fpa (FPA or FCA), quarterly_adjustment (QTA, Uniform Quarterly Adjustment), surcharge (Additional Surcharge PHL, F.C Surcharge),
  meter_rent (meter/service rent), subsidy (government subsidy/relief, negative), other.
  Tax types: gst (sales tax/GST including GST on FPA), electricity_duty (ED), income_tax, municipal_tax (e.g. KE MUCT/KMC),
  other_tax (extra tax, further tax, TV fee, anything else in the tax section).
- If the bill prints only one combined tax amount without separate lines, leave tax lines out and put it in total_taxes.
- LESCO / IESCO "BILL CHARGES BREAKDOWN" summary layout:
    "Total Electricity Charges" -> one charge line, type energy.
    "Subsidies" -> one charge line, type subsidy, negative amount (skip it if blank).
    "Net Electricity Charges" -> this is total_charges. It is NOT a line.
    "Taxes" (one combined amount) -> total_taxes. Do NOT add a tax line for it.
    "Current Bill" -> current_bill. "Grand Total" / "Payable within due date" -> payable_within_due_date.
    Amounts in the right-hand column (Arrears, Installment, Adjustments, W.E Credit, Total FPA) are NOT charge lines;
    put Arrears in arrears and Total FPA etc. in other_details.
- late_payment_amounts: every TOTAL amount payable after the due date (e.g. "Till 22-Apr-24-Apr Rs.3,574", "After 24-Apr Rs.3,716",
  "Upto 14/09/26 45088", "After 14/09/26 45263"). The "L.P Surcharge" row is only the surcharge, never put it here.
  If the payable-after-due-date box says something like "NOT TO BE PAID" instead of an amount, return an empty list.
- usage_history: read every bar/row of the month-wise units history, oldest first, excluding the current month.
  It normally covers the 12 months before the bill month. The first row is sometimes printed over the table header
  (e.g. "JUL 25  781  35,552" overlapping "MONTH STATUS UNITS BILL"); include it. Keep negative units negative (net metering).

Example: for a K-Electric bill (Bill Month Apr-26) the correct core values were:
tariff "A1-R", sanctioned_load_kw 3, reading_date "2026-04-03", issue_date "2026-04-07", due_date "2026-04-21",
previous_reading 8819, current_reading 8970, units_consumed 151,
charge lines: Fixed Charges 900 (fixed), Variable Upto 100 Units 1054 (energy), Variable Upto 200 Units 663.51 (energy),
Uniform Quarterly Adjustment 52.91 (quarterly_adjustment), FCA 125.27 (fpa), Additional Surcharge (PHL) 64.93 (surcharge),
total_charges 2860.62; tax lines: Electricity Duty 29.41 (electricity_duty), Sales Tax 520.21 (gst), MUCT (KMC) 20 (municipal_tax),
total_taxes 569.62, current_bill 3430.24, arrears -0.53, payable_within_due_date 3430, late amounts 3574 and 3716.

Return only the JSON object.`;

// ---------- cleaning ----------

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const credit = /CR\b/i.test(s) || /^\(.*\)$/.test(s);
  const n = Number(s.replace(/rs\.?|pkr|cr\b|[,\s()]/gi, ""));
  if (!Number.isFinite(n)) return null;
  return credit ? -Math.abs(n) : n;
}

function toDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toMonth(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^(\d{4}-\d{2})(-\d{2})?$/);
  return m ? m[1] : null;
}

function toText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** KESC_0002 -> KE, LESCO_0008 -> LESCO. The file name is more reliable than reading the logo. */
export function providerFromBillId(billId: string, printed: string | null): Level1["provider"] {
  const key = `${billId} ${printed ?? ""}`.toUpperCase();
  if (/KESC|K-ELECTRIC|\bKE\b/.test(key)) return "KE";
  if (/LESCO/.test(key)) return "LESCO";
  if (/IESCO/.test(key)) return "IESCO";
  return null;
}

function cleanFacts(raw: Partial<BillFacts>): BillFacts {
  const lines: BillLine[] = (raw.lines ?? []).map((l) => ({
    label: String(l.label ?? ""),
    section: l.section === "taxes" ? "taxes" : "charges",
    type: String(l.type ?? ""),
    units: toNumber(l.units),
    rate: toNumber(l.rate),
    amount: toNumber(l.amount),
  }));
  return {
    provider_printed: toText(raw.provider_printed),
    tariff: toText(raw.tariff),
    sanctioned_load_kw: toNumber(raw.sanctioned_load_kw),
    bill_month: toMonth(raw.bill_month),
    reading_date: toDate(raw.reading_date),
    issue_date: toDate(raw.issue_date),
    due_date: toDate(raw.due_date),
    previous_reading: toNumber(raw.previous_reading),
    current_reading: toNumber(raw.current_reading),
    units_consumed: toNumber(raw.units_consumed),
    lines,
    total_charges: toNumber(raw.total_charges),
    total_taxes: toNumber(raw.total_taxes),
    current_bill: toNumber(raw.current_bill),
    arrears: toNumber(raw.arrears),
    payable_within_due_date: toNumber(raw.payable_within_due_date),
    late_payment_amounts: (raw.late_payment_amounts ?? []).map((a) => ({ label: String(a.label ?? ""), amount: toNumber(a.amount) })),
    usage_history: (raw.usage_history ?? [])
      .map((h) => ({ month: toMonth(h.month) ?? String(h.month ?? ""), units: toNumber(h.units) }))
      .filter((h) => h.month),
    billing_history: (raw.billing_history ?? []).map((b) => ({
      month: toMonth(b.month) ?? String(b.month ?? ""),
      billed_amount: toNumber(b.billed_amount),
      payment_amount: toNumber(b.payment_amount),
      payment_date: toDate(b.payment_date),
    })),
    other_details: (raw.other_details ?? []).map((d) => ({ label: String(d.label ?? ""), value: String(d.value ?? "") })),
    reading_notes: toText(raw.reading_notes),
  };
}

// Subtotal rows sometimes come back as lines; they belong in total_charges / total_taxes.
const SUBTOTAL_LABEL = /net electricity charges|sub-?total|^total charges$|^electricity charges$|electricity charges for current month|^taxes and duties$/i;

const close = (a: number, b: number) => Math.abs(a - b) <= 1;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * Drops lines whose amount equals a printed subtotal (e.g. "Electricity Charges 38,098.01"
 * read as a tax line), but only when that makes the section add up to its total.
 */
function dropSubtotalLines(lines: BillLine[], total: number | null, subtotals: number[]): BillLine[] {
  if (total === null || close(sum(lines.map((l) => l.amount!)), total)) return lines;
  const filtered = lines.filter((l) => !subtotals.some((s) => close(l.amount!, s)));
  return filtered.length && close(sum(filtered.map((l) => l.amount!)), total) ? filtered : lines;
}

/** Builds the Level 1 JSON in the exact field order from the guide. */
// A single tax row with a generic label ("Taxes", "Taxes 15.24 %") is a combined amount.
const COMBINED_TAX_LABEL = /^\s*(total\s+)?(taxes|tax|taxes and duties|govt\.? charges|government charges)\b[\s\d.%]*$/i;

export function toLevel1(billId: string, f: BillFacts): Level1 {
  const kept = f.lines.filter((l) => l.amount !== null && l.amount !== 0);
  let totalCharges = f.total_charges;
  let totalTaxes = f.total_taxes;

  const subtotal = kept.find((l) => l.section === "charges" && SUBTOTAL_LABEL.test(l.label));
  if (subtotal && totalCharges === null) totalCharges = subtotal.amount;

  let taxLines = kept.filter((l) => l.section === "taxes" && !SUBTOTAL_LABEL.test(l.label));
  if (taxLines.length === 1 && COMBINED_TAX_LABEL.test(taxLines[0].label)) {
    if (totalTaxes === null) totalTaxes = taxLines[0].amount;
    taxLines = [];
  }

  const subtotals = [totalCharges, totalTaxes, f.current_bill].filter((x): x is number => x !== null);
  taxLines = dropSubtotalLines(taxLines, totalTaxes, subtotals);
  const chargeLines = dropSubtotalLines(
    kept.filter((l) => l.section === "charges" && l !== subtotal),
    totalCharges,
    subtotals,
  );

  const charges = chargeLines
    .map((l) => {
      const type: ChargeType = (CHARGE_TYPES as readonly string[]).includes(l.type) ? (l.type as ChargeType) : "other";
      const amount = type === "subsidy" ? -Math.abs(l.amount!) : l.amount!;
      return { type, amount };
    });
  const taxes = taxLines
    .map((l) => ({
      type: ((TAX_TYPES as readonly string[]).includes(l.type) ? l.type : "other_tax") as TaxType,
      amount: l.amount!,
    }));
  const lateAmounts = f.late_payment_amounts.map((a) => a.amount).filter((a): a is number => a !== null);

  // Readings that don't explain the billed units come from one of several meter rows
  // (net metering, peak/off-peak), so no single printed pair is "the" reading.
  let prevReading = f.previous_reading;
  let currReading = f.current_reading;
  if (prevReading !== null && currReading !== null && f.units_consumed !== null) {
    const diff = currReading - prevReading;
    const multiplier = diff ? f.units_consumed / diff : 0;
    if (Math.abs(diff - f.units_consumed) > 1 && !(Number.isInteger(Math.round(multiplier * 1000) / 1000) && multiplier > 1)) {
      prevReading = null;
      currReading = null;
    }
  }

  // A dropped "CR" shows up as a payable amount equal to minus (current bill + arrears).
  let payableWithin = f.payable_within_due_date;
  if (payableWithin !== null && payableWithin > 0 && f.current_bill !== null && f.arrears !== null) {
    const owed = f.current_bill + f.arrears;
    if (owed < 0 && Math.abs(payableWithin + owed) <= 1) payableWithin = -payableWithin;
  }

  return {
    provider: providerFromBillId(billId, f.provider_printed),
    tariff: f.tariff,
    sanctioned_load_kw: f.sanctioned_load_kw,
    bill_month: f.bill_month,
    reading_date: f.reading_date,
    issue_date: f.issue_date,
    due_date: f.due_date,
    previous_reading: prevReading,
    current_reading: currReading,
    units_consumed: f.units_consumed,
    charges,
    total_charges: totalCharges,
    taxes,
    total_taxes: totalTaxes,
    current_bill: f.current_bill,
    arrears: f.arrears,
    payable_within_due_date: payableWithin,
    payable_after_due_date: lateAmounts.length ? Math.max(...lateAmounts) : null,
  };
}

/** Cross-checks that should hold on a correctly read bill. Failed checks are sent back as feedback on a re-read. */
export function checkConsistency(l1: Level1, f?: BillFacts): string[] {
  const w: string[] = [];
  if (f && f.usage_history.length > 0 && f.usage_history.length < 12) {
    w.push(`usage_history has only ${f.usage_history.length} months; the history table normally shows 12 (check the first row, it can overlap the header)`);
  }
  if (l1.previous_reading !== null && l1.current_reading !== null && l1.units_consumed !== null) {
    const diff = l1.current_reading - l1.previous_reading;
    if (diff > 0 && !close(diff, l1.units_consumed)) {
      w.push(`units_consumed ${l1.units_consumed} != current_reading - previous_reading (${diff}); a meter multiplier or misread digit?`);
    }
  }
  if (l1.total_charges !== null && l1.charges.length && !close(sum(l1.charges.map((c) => c.amount)), l1.total_charges)) {
    w.push(`charge lines add up to ${sum(l1.charges.map((c) => c.amount)).toFixed(2)} but total_charges is ${l1.total_charges}`);
  }
  if (l1.total_taxes !== null && l1.taxes.length && !close(sum(l1.taxes.map((t) => t.amount)), l1.total_taxes)) {
    w.push(`tax lines add up to ${sum(l1.taxes.map((t) => t.amount)).toFixed(2)} but total_taxes is ${l1.total_taxes}`);
  }
  if (l1.total_charges !== null && l1.total_taxes !== null && l1.current_bill !== null &&
      !close(l1.total_charges + l1.total_taxes, l1.current_bill)) {
    w.push(`total_charges + total_taxes = ${(l1.total_charges + l1.total_taxes).toFixed(2)} but current_bill is ${l1.current_bill}`);
  }
  if (l1.payable_within_due_date !== null && l1.payable_after_due_date !== null &&
      l1.payable_after_due_date < l1.payable_within_due_date) {
    w.push(`payable_after_due_date ${l1.payable_after_due_date} is lower than payable_within_due_date ${l1.payable_within_due_date}`);
  }
  return w;
}

async function readBill(image: Buffer, mimeType: string, feedback?: string): Promise<BillFacts> {
  const prompt = feedback
    ? `${EXTRACTION_PROMPT}\n\nA first reading of this bill failed these checks:\n- ${feedback}\nLook at the bill again carefully and re-read the affected values. If the bill itself really prints these values, keep them as printed.`
    : EXTRACTION_PROMPT;
  const response = await generate(
    [{ role: "user", parts: [{ inlineData: { data: image.toString("base64"), mimeType } }, { text: prompt }] }],
    {
      responseMimeType: "application/json",
      responseSchema: FACTS_SCHEMA,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
    },
  );
  return cleanFacts(parseJson<Partial<BillFacts>>(response.text));
}

interface Reading {
  facts: BillFacts;
  level1: Level1;
  warnings: string[];
}

// Rounds numbers so 663.5 and 663.50 compare equal.
const key = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 100) / 100 : x));

/** Per-field majority vote over the readings; ties go to the reading that passes most checks. */
function vote(readings: Reading[]): Level1 {
  const ranked = [...readings].sort((a, b) => a.warnings.length - b.warnings.length);
  const voted = { ...ranked[0].level1 } as Record<string, unknown>;
  for (const field of Object.keys(voted)) {
    const counts = new Map<string, { n: number; value: unknown }>();
    for (const r of ranked) {
      const value = (r.level1 as unknown as Record<string, unknown>)[field];
      const k = key(value);
      counts.set(k, { n: (counts.get(k)?.n ?? 0) + 1, value: counts.get(k)?.value ?? value });
    }
    // Map keeps insertion order, so among equal counts the best-ranked reading wins.
    let best: { n: number; value: unknown } | undefined;
    for (const c of counts.values()) if (!best || c.n > best.n) best = c;
    voted[field] = best!.value;
  }
  return voted as unknown as Level1;
}

/**
 * Reads one bill with self-consistency: two independent readings; if they disagree
 * on any Level 1 field, a third reading (told which checks failed, if any) breaks the
 * tie with a per-field majority vote. Random misreads rarely repeat, so this removes most of them.
 */
export async function decodeBill(billId: string, image: Buffer, mimeType: string): Promise<DecodedBill> {
  const read = async (feedback?: string): Promise<Reading> => {
    const facts = await readBill(image, mimeType, feedback);
    const level1 = toLevel1(billId, facts);
    return { facts, level1, warnings: checkConsistency(level1, facts) };
  };

  const readings = [await read()];
  try {
    readings.push(await read());
    if (key(readings[0].level1) !== key(readings[1].level1)) {
      const failed = [...new Set(readings.flatMap((r) => r.warnings))];
      readings.push(await read(failed.length ? failed.join("\n- ") : undefined));
    }
  } catch (err) {
    // Extra readings are a bonus; keep what we have if one fails.
    console.warn(`  ${billId}: extra reading failed: ${(err as Error).message}`);
  }

  const level1 = readings.length === 1 ? readings[0].level1 : vote(readings);
  // Keep the facts (used for Level 2) from the reading that agrees most with the vote.
  const agreement = (r: Reading) =>
    Object.keys(level1).filter((k) => key((r.level1 as never)[k]) === key((level1 as never)[k])).length;
  const facts = [...readings].sort((a, b) => agreement(b) - agreement(a))[0].facts;
  return { billId, level1, facts, warnings: checkConsistency(level1, facts) };
}

/** A Level 1 object with every field null, used when a bill cannot be read at all. */
export function emptyLevel1(billId: string): Level1 {
  return toLevel1(billId, cleanFacts({}));
}

export function mimeTypeFor(file: string) {
  const ext = file.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}
