// Scores level1.csv against expected JSON files, field by field, the way the
// guide describes (text/dates exact, numbers within ±1). For checking our own work.
//
//   npm run compare -- output/sample/level1.csv data/sample/expected
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const [csvFile, expectedDir] = process.argv.slice(2);
if (!csvFile || !expectedDir) {
  console.error("Usage: npm run compare -- <level1.csv> <folder of expected <bill_id>.json>");
  process.exit(1);
}

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1 : JSON.stringify(a) === JSON.stringify(b);

let right = 0;
let total = 0;
for (const row of parse(fs.readFileSync(csvFile, "utf8"), { columns: true }) as { bill_id: string; json: string }[]) {
  const file = path.join(expectedDir, `${row.bill_id}.json`);
  if (!fs.existsSync(file)) continue;
  const expected = JSON.parse(fs.readFileSync(file, "utf8"));
  const got = JSON.parse(row.json);
  console.log(`\n${row.bill_id}`);
  for (const key of Object.keys(expected)) {
    total++;
    const ok = Array.isArray(expected[key])
      ? JSON.stringify(expected[key].map((x: { type: string; amount: number }) => `${x.type}:${Math.round(x.amount)}`)) ===
        JSON.stringify((got[key] ?? []).map((x: { type: string; amount: number }) => `${x.type}:${Math.round(x.amount)}`))
      : same(got[key], expected[key]);
    if (ok) right++;
    else console.log(`  WRONG ${key}: got ${JSON.stringify(got[key])}, expected ${JSON.stringify(expected[key])}`);
  }
}
console.log(`\n${right}/${total} fields correct`);
