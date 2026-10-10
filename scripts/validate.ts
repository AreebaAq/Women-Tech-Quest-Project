// Checks the output CSVs against the templates and the guide's format rules (sections 5, 7.1, 7.2).
//
//   npm run validate -- --csv data/test/csv --out output
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { CHARGE_TYPES, TAX_TYPES } from "../src/lib/types";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const csvDir = arg("csv");
const outDir = arg("out") ?? "output";
if (!csvDir) {
  console.error("Usage: npm run validate -- --csv <template folder> --out <output folder>");
  process.exit(1);
}

const problems: string[] = [];
const read = (file: string) => {
  const text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) problems.push(`${file}: starts with a BOM`);
  return parse(text, { columns: true, bom: true }) as Record<string, string>[];
};

const FIELDS = [
  "provider", "tariff", "sanctioned_load_kw", "bill_month", "reading_date", "issue_date", "due_date",
  "previous_reading", "current_reading", "units_consumed", "charges", "total_charges", "taxes", "total_taxes",
  "current_bill", "arrears", "payable_within_due_date", "payable_after_due_date",
];
const NUMBER_FIELDS = FIELDS.filter((f) => !["provider", "tariff", "bill_month", "reading_date", "issue_date", "due_date", "charges", "taxes"].includes(f));
const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const PERSONAL = /\b(name|address|cnic|account|reference|consumer (no|id|number)|meter (no|number))\b/i;

function checkSameRows(file: string, template: Record<string, string>[], output: Record<string, string>[], keep: string[], fill: string) {
  const tCols = Object.keys(template[0] ?? {});
  const oCols = Object.keys(output[0] ?? {});
  if (tCols.join() !== oCols.join()) problems.push(`${file}: columns ${oCols.join(",")} != template ${tCols.join(",")}`);
  if (template.length !== output.length) problems.push(`${file}: ${output.length} rows, template has ${template.length}`);
  template.forEach((t, i) => {
    const o = output[i];
    if (!o) return;
    for (const k of keep) if (t[k] !== o[k]) problems.push(`${file} row ${i + 2}: ${k} changed ("${t[k]}" -> "${o[k]}")`);
    if (!o[fill]?.trim()) problems.push(`${file} row ${i + 2}: empty ${fill}`);
  });
}

// ---- level1.csv ----
const t1 = read(path.join(csvDir, "level1.csv"));
const o1 = read(path.join(outDir, "level1.csv"));
checkSameRows("level1.csv", t1, o1, ["bill_id"], "json");
const raw1 = fs.readFileSync(path.join(outDir, "level1.csv"), "utf8");
if (raw1.trim().split(/\r?\n/).length !== o1.length + 1) problems.push("level1.csv: a JSON value spans more than one line");

for (const row of o1) {
  const where = `level1.csv ${row.bill_id}`;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(row.json);
  } catch {
    problems.push(`${where}: json is not valid JSON`);
    continue;
  }
  if (Object.keys(j).join() !== FIELDS.join()) problems.push(`${where}: fields/order differ from the guide`);
  const expectedProvider = /^KESC/i.test(row.bill_id) ? "KE" : /^LESCO/i.test(row.bill_id) ? "LESCO" : /^IESCO/i.test(row.bill_id) ? "IESCO" : null;
  if (j.provider !== expectedProvider) problems.push(`${where}: provider ${j.provider}, expected ${expectedProvider}`);
  if (!(j.tariff === null || typeof j.tariff === "string")) problems.push(`${where}: tariff must be text or null`);
  for (const f of NUMBER_FIELDS) if (!isNumOrNull(j[f])) problems.push(`${where}: ${f} must be a number or null (got ${JSON.stringify(j[f])})`);
  if (!(j.bill_month === null || /^\d{4}-\d{2}$/.test(String(j.bill_month)))) problems.push(`${where}: bill_month not YYYY-MM`);
  for (const f of ["reading_date", "issue_date", "due_date"]) {
    if (!(j[f] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(j[f])))) problems.push(`${where}: ${f} not YYYY-MM-DD`);
  }
  for (const [list, types] of [["charges", CHARGE_TYPES], ["taxes", TAX_TYPES]] as const) {
    if (!Array.isArray(j[list])) {
      problems.push(`${where}: ${list} must be a list`);
      continue;
    }
    for (const item of j[list] as { type: string; amount: unknown }[]) {
      if (Object.keys(item).join() !== "type,amount") problems.push(`${where}: ${list} item must have exactly type, amount`);
      if (!(types as readonly string[]).includes(item.type)) problems.push(`${where}: ${list} type "${item.type}" not allowed`);
      if (typeof item.amount !== "number" || item.amount === 0) problems.push(`${where}: ${list} amount must be a non-zero number`);
      if (item.type === "subsidy" && (item.amount as number) > 0) problems.push(`${where}: subsidy must be negative`);
    }
  }
}

// ---- level2.csv ----
const t2 = read(path.join(csvDir, "level2.csv"));
const o2 = read(path.join(outDir, "level2.csv"));
checkSameRows("level2.csv", t2, o2, ["bill_id", "question_id", "question"], "answer");
for (const [i, row] of o2.entries()) {
  const where = `level2.csv row ${i + 2} (${row.bill_id} ${row.question_id})`;
  const a = row.answer ?? "";
  if (/\bnull\b|PRECOMPUTED|BILL DATA|json|submit_answers|calculate tool/i.test(a)) problems.push(`${where}: answer mentions internal terms`);
  if (/^Sorry, an answer could not be generated/.test(a)) problems.push(`${where}: fallback answer`);
  if (/[؀-ۿ]/.test(a)) problems.push(`${where}: answer contains Urdu script`);
  if (/[*#`]/.test(a)) problems.push(`${where}: answer contains markdown`);
  if (PERSONAL.test(a) && /\d{6,}/.test(a)) problems.push(`${where}: answer may contain a personal identifier`);
}

console.log(`level1.csv: ${o1.length} rows | level2.csv: ${o2.length} rows`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("All checks passed.");
