# Utility Bill Decoder (Women Tech Quest 2026, Build Track)

Reads K-Electric, LESCO and IESCO electricity bill images, extracts the billing details as JSON (Level 1),
and answers customer questions about each bill in plain English (Level 2).

- **Runtime:** Node.js 24 (any Node.js 22 or later works)
- **Model:** Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) via the Google AI Studio API
- **Stack:** TypeScript, Next.js 16 (web demo), `@google/genai`, `csv-parse` / `csv-stringify`, `mathjs`, `tsx`

## Setup

```
npm install
copy .env.example .env      # Windows (macOS/Linux: cp .env.example .env)
```

Then put your Gemini API key in `.env` as `API_KEY=...`. Check it works:

```
npm run test:api
```

## Generate the result CSVs

Point `--bills` at the folder of bill images and `--csv` at the folder that holds the `level1.csv` and
`level2.csv` templates:

```
npm run decode -- --bills data/test/bills --csv data/test/csv --out output
```

This writes `output/level1.csv` (one JSON per bill) and `output/level2.csv` (one answer per question).
Results are cached in `output/cache/`, so if a run is interrupted (e.g. by the free-tier rate limit),
running the same command again only redoes the bills that failed. Add `--fresh` to ignore the cache.

Without `--csv`, every image in `--bills` is extracted and only `level1.csv` is written:

```
npm run decode -- --bills data/train/bills --out output/train
```

## Web demo

```
npm run dev        # then open http://localhost:3000
```

Upload a bill, click **Decode bill** to see the Level 1 fields (summary or raw JSON), then ask questions.

## How it works

```
bill image ──► Gemini read ×2 (vision, JSON schema) ──► code: rules + checks ──► agree? ──► Level 1 JSON
                                                                │ no
                                                                └► 3rd read with failed checks ──► per-field vote
questions ──► Gemini + tools (calculate, history_months) + precomputed stats ──► Level 2 answers
```

1. **Read** (`src/lib/extract.ts`): the bill image is sent to Gemini at high media resolution with a strict
   JSON response schema. The model only transcribes: every printed charge and tax line (label, section, type,
   amount), dates, readings, totals, late-payment amounts, usage history and billing history. The prompt
   covers each layout (K-Electric bill calculation, LESCO/IESCO "bill charges breakdown" summary), net
   metering, Urdu labels and `CR` credits.
2. **Apply the guide's rules in code** (`toLevel1`): provider from the file name (KESC → KE), lines printed as 0
   dropped, subsidies negative, subtotal rows moved to `total_charges` / `total_taxes`, a single combined tax
   amount → `taxes: []`, `payable_after_due_date` = highest late-payment amount, a dropped `CR` sign detected
   from current bill + arrears, readings that cannot explain the billed units (several meter rows) → `null`,
   dates and numbers validated (invalid → `null`), fields output in the guide's exact order.
3. **Self-consistency** (`decodeBill`): each bill is read twice independently. If the two Level 1 results differ,
   a third reading is made, given any failed checks as feedback (`checkConsistency`: readings vs units, lines vs
   subtotals, charges + taxes vs current bill, 12-month history), and each field is decided by majority vote.
   Random misreads rarely repeat, so voting removes most of them.
4. **Answer** (`src/lib/answer.ts`, `src/lib/stats.ts`): all 12 questions for a bill are answered in one
   conversation. Code precomputes the common numbers (averages, highs/lows, month comparisons, tax
   percentages, cost per unit, late-payment difference, days to due date). For anything else the model must
   call tools: `calculate` (arithmetic, evaluated with `mathjs`) and `history_months` (exact filtering and
   counting of usage months). Numbers never come from the model's head. The prompt requires answers grounded
   only in the bill, labelled estimates, stated interpretations for ambiguous questions, and plain English.
5. **Robustness** (`src/lib/llm.ts`, `scripts/decode.ts`): requests are spaced to respect 15 requests/min,
   temporary errors (429/503) are retried with backoff, every bill is cached (code rules are re-applied to
   cached readings), a failed bill still produces a valid all-`null` JSON row, and missing answers are re-asked
   once before a clear fallback answer is used, so no CSV cell is ever empty. CSVs are written with a CSV
   library, keeping the template's columns and row order.

### Accuracy check

`data/sample/expected/` holds hand-checked Level 1 JSON for the five training bills (KESC_0008 from the
guide's worked example). `npm run compare -- output/train/level1.csv data/sample/expected` scores a run the
way the guide does (text exact, numbers ±1). Current result: 90/90 fields.

### Project layout

| Path | Purpose |
|---|---|
| `scripts/decode.ts` | Batch CLI: bill folder + CSV templates → `output/level1.csv`, `output/level2.csv` |
| `src/lib/llm.ts` | The only module that calls the model (rate limit, retries, JSON parsing) |
| `src/lib/extract.ts` | Level 1: prompt, response schema, code rules, consistency checks, voting |
| `src/lib/answer.ts` | Level 2: prompt, tool loop (`calculate`, `history_months`) |
| `src/lib/stats.ts` | Numbers precomputed in code for Level 2 |
| `src/lib/types.ts` | Shared types and the allowed charge/tax types |
| `src/app/` | Next.js web demo (`page.tsx`) and its API routes (`api/decode`, `api/ask`) |
| `scripts/compare.ts` | Dev tool: scores a `level1.csv` against expected JSON (`npm run compare`) |
| `scripts/test-api.mjs` | Checks the API key with one call |

## Environment variables

| Variable | Value |
|---|---|
| `MODEL_PROVIDER` | `google` |
| `MODEL_NAME` | `gemini-3.5-flash-lite` |
| `API_KEY` | Google AI Studio API key (secret, not included) |
| `MIN_REQUEST_GAP_MS` | Optional, default `4500` (keeps under 15 requests/min) |

## AI usage

- **Models used by the solution:** Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`), for reading the bill images
  (Level 1) and writing the answers (Level 2). No other model is called.
- **APIs:** Google Gemini API (Google AI Studio) through the official `@google/genai` SDK.
- **Services:** none (no OCR services, invoice/receipt extraction services, or Azure services).
- **Local OCR libraries:** none.
- **AI tools used to write the code:** Claude Code (Anthropic, Claude Opus 5.5) was used as a coding
  assistant to write and review the code.
