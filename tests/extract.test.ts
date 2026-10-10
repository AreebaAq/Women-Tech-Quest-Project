// Unit tests for the code rules applied after the model reads a bill. No API calls.
// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConsistency, emptyLevel1, providerFromBillId, toLevel1 } from "../src/lib/extract";
import { computeStats } from "../src/lib/stats";
import type { BillFacts, BillLine } from "../src/lib/types";

const line = (label: string, section: "charges" | "taxes", type: string, amount: number | null): BillLine => ({
  label, section, type, units: null, rate: null, amount,
});

function facts(overrides: Partial<BillFacts>): BillFacts {
  return {
    provider_printed: null, tariff: null, sanctioned_load_kw: null, bill_month: null, reading_date: null,
    issue_date: null, due_date: null, previous_reading: null, current_reading: null, units_consumed: null,
    lines: [], total_charges: null, total_taxes: null, current_bill: null, arrears: null,
    payable_within_due_date: null, late_payment_amounts: [], usage_history: [], billing_history: [],
    other_details: [], reading_notes: null,
    ...overrides,
  };
}

// The guide's worked example (section 5.7), as the model would read it.
const kesc0008 = facts({
  tariff: "A1-R", sanctioned_load_kw: 3, bill_month: "2026-04", reading_date: "2026-04-03",
  issue_date: "2026-04-07", due_date: "2026-04-21", previous_reading: 8819, current_reading: 8970, units_consumed: 151,
  lines: [
    line("Fixed Charges", "charges", "fixed", 900),
    line("Variable Upto 100 Units", "charges", "energy", 1054),
    line("Variable Upto 200 Units", "charges", "energy", 663.51),
    line("Uniform Quarterly Adjustment", "charges", "quarterly_adjustment", 52.91),
    line("FCA Feb-26", "charges", "fpa", 125.27),
    line("Additional Surcharge (PHL)", "charges", "surcharge", 64.93),
    line("Electricity Duty", "taxes", "electricity_duty", 29.41),
    line("Sales Tax", "taxes", "gst", 520.21),
    line("MUCT (KMC)", "taxes", "municipal_tax", 20),
  ],
  total_charges: 2860.62, total_taxes: 569.62, current_bill: 3430.24, arrears: -0.53, payable_within_due_date: 3430,
  late_payment_amounts: [{ label: "Till 22-Apr-24-Apr", amount: 3574 }, { label: "After 24-Apr", amount: 3716 }],
});

test("worked example KESC_0008 produces the guide's JSON", () => {
  const l1 = toLevel1("KESC_0008", kesc0008);
  assert.equal(
    JSON.stringify(l1),
    '{"provider":"KE","tariff":"A1-R","sanctioned_load_kw":3,"bill_month":"2026-04","reading_date":"2026-04-03",' +
      '"issue_date":"2026-04-07","due_date":"2026-04-21","previous_reading":8819,"current_reading":8970,"units_consumed":151,' +
      '"charges":[{"type":"fixed","amount":900},{"type":"energy","amount":1054},{"type":"energy","amount":663.51},' +
      '{"type":"quarterly_adjustment","amount":52.91},{"type":"fpa","amount":125.27},{"type":"surcharge","amount":64.93}],' +
      '"total_charges":2860.62,"taxes":[{"type":"electricity_duty","amount":29.41},{"type":"gst","amount":520.21},' +
      '{"type":"municipal_tax","amount":20}],"total_taxes":569.62,"current_bill":3430.24,"arrears":-0.53,' +
      '"payable_within_due_date":3430,"payable_after_due_date":3716}',
  );
  assert.deepEqual(checkConsistency(l1), []);
});

test("provider comes from the file name; KESC maps to KE", () => {
  assert.equal(providerFromBillId("KESC_0002", null), "KE");
  assert.equal(providerFromBillId("LESCO_0008", null), "LESCO");
  assert.equal(providerFromBillId("IESCO_0002", "Islamabad Electric"), "IESCO");
});

test("LESCO/IESCO summary layout: subtotal is not a line, combined tax gives []", () => {
  const l1 = toLevel1("IESCO_0004", facts({
    lines: [
      line("Total Electricity Charges", "charges", "energy", 6102),
      line("Subsidies", "charges", "subsidy", 3332),
      line("Net Electricity Charges", "charges", "energy", 2770),
      line("Taxes 15.24 %", "taxes", "other_tax", 498),
    ],
    current_bill: 3267,
  }));
  assert.deepEqual(l1.charges, [{ type: "energy", amount: 6102 }, { type: "subsidy", amount: -3332 }]);
  assert.equal(l1.total_charges, 2770);
  assert.deepEqual(l1.taxes, []);
  assert.equal(l1.total_taxes, 498);
});

test("lines printed as 0 or blank are skipped; repeated types are kept", () => {
  const l1 = toLevel1("KESC_1", facts({
    lines: [
      line("Uniform Quarterly Adjustment", "charges", "quarterly_adjustment", -1442.74),
      line("Uniform Quarterly Adjustment", "charges", "quarterly_adjustment", 61.1),
      line("Meter Rent", "charges", "meter_rent", 0),
      line("Subsidies", "charges", "subsidy", null),
    ],
  }));
  assert.deepEqual(l1.charges.map((c) => c.amount), [-1442.74, 61.1]);
});

test("a subtotal read as a tax line is dropped when that makes taxes add up", () => {
  const l1 = toLevel1("KESC_0004", facts({
    lines: [
      line("Electricity Charges", "taxes", "other_tax", 38098.01),
      line("Electricity Duty", "taxes", "electricity_duty", 520.85),
      line("Sales Tax", "taxes", "gst", 6951.39),
    ],
    total_charges: 38098.01, total_taxes: 7472.24, current_bill: 45570.25,
  }));
  assert.deepEqual(l1.taxes.map((t) => t.type), ["electricity_duty", "gst"]);
});

test("a dropped CR sign on the payable amount is restored", () => {
  const l1 = toLevel1("LESCO_0005", facts({ current_bill: 20726, arrears: -75496, payable_within_due_date: 54770 }));
  assert.equal(l1.payable_within_due_date, -54770);
});

test("readings from one of several meter rows become null; a meter multiplier is allowed", () => {
  const multiRow = toLevel1("KESC_1", facts({ previous_reading: 1163.29, current_reading: 1923.73, units_consumed: 901 }));
  assert.equal(multiRow.previous_reading, null);
  const withMF = toLevel1("LESCO_1", facts({ previous_reading: 100, current_reading: 110, units_consumed: 400 }));
  assert.equal(withMF.previous_reading, 100);
});

test("no late-payment amount gives null; several give the highest", () => {
  assert.equal(toLevel1("LESCO_1", facts({})).payable_after_due_date, null);
  assert.equal(toLevel1("KESC_0008", kesc0008).payable_after_due_date, 3716);
});

test("an unreadable bill still has every field", () => {
  const keys = Object.keys(emptyLevel1("IESCO_9"));
  assert.equal(keys.length, 18);
  assert.equal(keys[0], "provider");
  assert.equal(keys.at(-1), "payable_after_due_date");
});

test("stats: tax share and late payment difference", () => {
  const s = computeStats(toLevel1("KESC_0008", kesc0008), kesc0008);
  assert.equal(s.money.taxes_percent_of_current_bill, 16.61);
  assert.equal(s.money.late_payment_extra, 286);
  assert.equal(s.dates.days_from_issue_to_due, 14);
});

test("late payment schedule turns printed labels into date ranges", () => {
  const ke = computeStats(toLevel1("KESC_0008", kesc0008), kesc0008).money.late_payment_schedule;
  assert.deepEqual(ke?.map((b) => [b.pay_between, b.days_late, b.amount]), [
    ["2026-04-22 to 2026-04-24", "1 to 3 days late", 3574],
    ["2026-04-25 to onwards", "4 or more days late", 3716],
  ]);
  const lesco = facts({
    due_date: "2026-09-09",
    late_payment_amounts: [{ label: "Upto 14/09/26", amount: 45088 }, { label: "After 14/09/26", amount: 45263 }],
  });
  const sched = computeStats(toLevel1("LESCO_0006", lesco), lesco).money.late_payment_schedule;
  assert.deepEqual(sched?.map((b) => [b.pay_between, b.amount]), [
    ["2026-09-10 to 2026-09-14", 45088],
    ["2026-09-15 to onwards", 45263],
  ]);
});
