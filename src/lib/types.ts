// Shapes shared by extraction, answering, the CLI and the web app.

export const CHARGE_TYPES = ["energy", "fixed", "fpa", "quarterly_adjustment", "surcharge", "meter_rent", "subsidy", "other"] as const;
export const TAX_TYPES = ["gst", "electricity_duty", "income_tax", "municipal_tax", "other_tax"] as const;

export type ChargeType = (typeof CHARGE_TYPES)[number];
export type TaxType = (typeof TAX_TYPES)[number];

/** Level 1 output: exactly the fields and order from the participant guide (section 5.1). */
export interface Level1 {
  provider: "KE" | "LESCO" | "IESCO" | null;
  tariff: string | null;
  sanctioned_load_kw: number | null;
  bill_month: string | null;
  reading_date: string | null;
  issue_date: string | null;
  due_date: string | null;
  previous_reading: number | null;
  current_reading: number | null;
  units_consumed: number | null;
  charges: { type: ChargeType; amount: number }[];
  total_charges: number | null;
  taxes: { type: TaxType; amount: number }[];
  total_taxes: number | null;
  current_bill: number | null;
  arrears: number | null;
  payable_within_due_date: number | null;
  payable_after_due_date: number | null;
}

/** One printed line in the charges or taxes section, with its label for explanations. */
export interface BillLine {
  label: string;
  section: "charges" | "taxes";
  type: string;
  units: number | null;
  rate: number | null;
  amount: number | null;
}

/** Everything the model reads from the bill. Level 1 is derived from this; Level 2 uses all of it. */
export interface BillFacts {
  provider_printed: string | null;
  tariff: string | null;
  sanctioned_load_kw: number | null;
  bill_month: string | null;
  reading_date: string | null;
  issue_date: string | null;
  due_date: string | null;
  previous_reading: number | null;
  current_reading: number | null;
  units_consumed: number | null;
  lines: BillLine[];
  total_charges: number | null;
  total_taxes: number | null;
  current_bill: number | null;
  arrears: number | null;
  payable_within_due_date: number | null;
  late_payment_amounts: { label: string; amount: number | null }[];
  usage_history: { month: string; units: number | null }[];
  billing_history: { month: string; billed_amount: number | null; payment_amount: number | null; payment_date: string | null }[];
  other_details: { label: string; value: string }[];
  reading_notes: string | null;
}

export interface DecodedBill {
  billId: string;
  level1: Level1;
  facts: BillFacts;
  warnings: string[];
}
