// Batch run: reads a folder of bill images and the CSV templates, writes both result CSVs.
//
//   npm run decode -- --bills data/test/bills --csv data/test/csv --out output
//
// Without --csv it extracts every image in --bills (useful for the training bills).
// Results are cached in <out>/cache, so re-running after an error only redoes what failed.
// Use --fresh to ignore the cache.
import "./load-env"; // must stay first: the lib reads MODEL_NAME when it loads
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { answerQuestions, type Question } from "../src/lib/answer";
import { checkConsistency, decodeBill, emptyLevel1, mimeTypeFor, toLevel1 } from "../src/lib/extract";
import { MODEL_NAME, MODEL_PROVIDER } from "../src/lib/llm";
import type { DecodedBill } from "../src/lib/types";

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const FALLBACK_ANSWER =
  "Sorry, this bill could not be read reliably enough to answer this question, so no figure is given rather than guessing.";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const fresh = process.argv.includes("--fresh");

const billsDir = arg("bills");
const csvDir = arg("csv");
const outDir = arg("out", "output")!;
if (!billsDir) {
  console.error("Usage: npm run decode -- --bills <folder> [--csv <folder with level1.csv, level2.csv>] [--out output] [--fresh]");
  process.exit(1);
}
const cacheDir = path.join(outDir, "cache");
fs.mkdirSync(cacheDir, { recursive: true });

function readCsv(file: string): Record<string, string>[] {
  return parse(fs.readFileSync(file, "utf8"), { columns: true, bom: true, skip_empty_lines: true });
}

function writeCsv(file: string, rows: Record<string, string>[], columns: string[]) {
  fs.writeFileSync(file, stringify(rows, { header: true, columns }), "utf8");
  console.log(`Wrote ${file} (${rows.length} rows)`);
}

function findImage(billId: string): string | null {
  for (const ext of IMAGE_EXT) {
    for (const name of [billId + ext, billId + ext.toUpperCase()]) {
      const p = path.join(billsDir!, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function readCache<T>(file: string): T | null {
  if (fresh || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function getDecoded(billId: string): Promise<DecodedBill> {
  const cacheFile = path.join(cacheDir, `${billId}.json`);
  const cached = readCache<DecodedBill>(cacheFile);
  if (cached?.facts) {
    // Re-apply the code rules to the cached model reading, so rule changes need no new model calls.
    const level1 = toLevel1(billId, cached.facts);
    return { ...cached, level1, warnings: checkConsistency(level1, cached.facts) };
  }

  const image = findImage(billId);
  if (!image) {
    console.error(`  ${billId}: image not found in ${billsDir}`);
    return { billId, level1: emptyLevel1(billId), facts: null as never, warnings: ["image not found"] };
  }
  try {
    const decoded = await decodeBill(billId, fs.readFileSync(image), mimeTypeFor(image));
    fs.writeFileSync(cacheFile, JSON.stringify(decoded, null, 2));
    return decoded;
  } catch (err) {
    console.error(`  ${billId}: extraction failed: ${(err as Error).message}`);
    return { billId, level1: emptyLevel1(billId), facts: null as never, warnings: [`extraction failed: ${(err as Error).message}`] };
  }
}

async function getAnswers(bill: DecodedBill, questions: Question[]): Promise<Map<string, string>> {
  const cacheFile = path.join(cacheDir, `${bill.billId}.answers.json`);
  const cached = readCache<{ question: string; question_id: string; answer: string }[]>(cacheFile);
  if (cached && questions.every((q) => cached.some((c) => c.question_id === q.question_id && c.question === q.question && c.answer))) {
    return new Map(cached.map((c) => [c.question_id, c.answer]));
  }
  if (!bill.facts) return new Map();
  try {
    const answers = await answerQuestions(bill, questions);
    const missing = questions.filter((q) => !answers.has(q.question_id));
    if (missing.length) {
      // One follow-up call for any question the model skipped.
      console.warn(`  ${bill.billId}: ${missing.length} answers missing, asking again`);
      for (const [id, a] of await answerQuestions(bill, missing)) answers.set(id, a);
    }
    fs.writeFileSync(cacheFile, JSON.stringify(questions.map((q) => ({ ...q, answer: answers.get(q.question_id) ?? "" })), null, 2));
    return answers;
  } catch (err) {
    console.error(`  ${bill.billId}: answering failed: ${(err as Error).message}`);
    return new Map();
  }
}

async function main() {
  console.log(`Model: ${MODEL_PROVIDER} / ${MODEL_NAME}`);
  fs.mkdirSync(outDir, { recursive: true });

  const level1File = csvDir && path.join(csvDir, "level1.csv");
  const level2File = csvDir && path.join(csvDir, "level2.csv");

  // ---- Level 1 ----
  let l1Rows: Record<string, string>[];
  let l1Columns = ["bill_id", "json"];
  if (level1File && fs.existsSync(level1File)) {
    l1Rows = readCsv(level1File);
    l1Columns = Object.keys(l1Rows[0] ?? { bill_id: "", json: "" });
  } else {
    l1Rows = fs
      .readdirSync(billsDir!)
      .filter((f) => IMAGE_EXT.includes(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => ({ bill_id: path.parse(f).name, json: "" }));
  }

  const decoded = new Map<string, DecodedBill>();
  for (const [i, row] of l1Rows.entries()) {
    const billId = row.bill_id.trim();
    console.log(`[L1 ${i + 1}/${l1Rows.length}] ${billId}`);
    const bill = await getDecoded(billId);
    decoded.set(billId, bill);
    for (const w of bill.warnings) console.warn(`  check: ${w}`);
    row.json = JSON.stringify(bill.level1);
  }
  writeCsv(path.join(outDir, "level1.csv"), l1Rows, l1Columns);

  // ---- Level 2 ----
  if (!level2File || !fs.existsSync(level2File)) {
    console.log("No level2.csv template given, skipping Level 2.");
    return;
  }
  const l2Rows = readCsv(level2File);
  const l2Columns = Object.keys(l2Rows[0] ?? { bill_id: "", question_id: "", question: "", answer: "" });
  const billIds = [...new Set(l2Rows.map((r) => r.bill_id.trim()))];

  for (const [i, billId] of billIds.entries()) {
    console.log(`[L2 ${i + 1}/${billIds.length}] ${billId}`);
    const bill = decoded.get(billId) ?? (await getDecoded(billId));
    const rows = l2Rows.filter((r) => r.bill_id.trim() === billId);
    const answers = await getAnswers(bill, rows.map((r) => ({ question_id: r.question_id.trim(), question: r.question })));
    for (const row of rows) row.answer = answers.get(row.question_id.trim()) || FALLBACK_ANSWER;
  }
  writeCsv(path.join(outDir, "level2.csv"), l2Rows, l2Columns);

  const fallbacks = l2Rows.filter((r) => r.answer === FALLBACK_ANSWER).length;
  if (fallbacks) console.warn(`${fallbacks} answers used the fallback text. Re-run to retry them (cached results are reused).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
