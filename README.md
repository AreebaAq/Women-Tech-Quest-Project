# Utility Bill Decoder

Women Tech Quest 2026, Build Track. An AI assistant that reads K-Electric, LESCO and IESCO electricity bill
images, extracts the billing details as JSON (Level 1), and answers customer questions about each bill in
plain English (Level 2).

- **Model:** Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`), Google AI Studio API
- **Runtime:** Node.js 24 (tested with v24.20.0). Any Node.js 22 or later works.
- **Language:** TypeScript

## Requirements

- Node.js 22 or later, with npm
- A Google AI Studio API key (free, no credit card): https://aistudio.google.com → **Get API key**

## Dependencies

Exact versions are pinned in `package.json` and locked in `package-lock.json`. `npm install` installs them.

| Package | Version | Used for |
|---|---|---|
| `@google/genai` | 2.28.0 | Official Gemini SDK (the only model API used) |
| `csv-parse` / `csv-stringify` | 7.0.3 / 6.9.0 | Reading the CSV templates and writing the results safely |
| `mathjs` | 15.2.0 | Evaluating the model's `calculate` tool calls exactly |
| `tsx` | 4.23.15 | Running the TypeScript command-line scripts |
| `next`, `react`, `react-dom` | 16.4.0, 19.3.0, 19.3.0 | Web demo UI |
| `typescript`, `eslint`, `tailwindcss` (dev) | 5.9.3, 9.39.5, 4.3.3 | Type checking, linting, styling |

## Setup

Run these inside this folder (`source/` in the submission):

```
npm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
```

Open `.env` and replace `your-api-key-here` with your API key. Then check the key works (one model call):

```
npm run test:api
```

## Generate both CSV files

`--bills` is the folder of bill images (`.png` / `.jpg`). `--csv` is the folder containing the `level1.csv` and
`level2.csv` templates. `--out` is where the completed files are written.

```
npm run decode -- --bills <path-to-test>/bills --csv <path-to-test>/csv --out output
```

For example, with the test data copied to `data/test/`:

```
npm run decode -- --bills data/test/bills --csv data/test/csv --out output
```

This writes:

| File | Contents |
|---|---|
| `output/level1.csv` | One row per bill: `bill_id`, `json` (the Level 1 JSON object on one line) |
| `output/level2.csv` | One row per bill and question: `bill_id`, `question_id`, `question`, `answer` |

The template's columns, row order, `bill_id`, `question_id` and `question` are kept unchanged. The files are UTF-8
and written with a CSV library, so cells with commas, quotes or line breaks are quoted correctly.

**Run time:** about 4–6 minutes for 10 bills and 120 questions on the free tier (requests are spaced to stay
under 15 requests/minute). Results are cached per bill in `output/cache/`, so if a run is interrupted, running
the same command again continues where it stopped. Add `--fresh` to ignore the cache.

Without `--csv`, every image in `--bills` is extracted and only `level1.csv` is written:

```
npm run decode -- --bills data/train/bills --out output/train
```

## Web demo

```
npm run dev
```

Open http://localhost:3000, upload a bill image, click **Decode bill** to see the Level 1 fields (summary and
raw JSON), then ask questions or pick a suggested one. It uses the same code as the command-line run.

## How it works

```
bill image ─► Gemini reads it twice (vision + JSON schema) ─► code applies the guide's rules + checks
                                                               │
                         both readings agree? ── yes ─────────►├─► Level 1 JSON
                                 │ no                          │
                                 └► 3rd reading, told which checks failed ─► per-field majority vote

questions ─► Gemini + tools (calculate, history_months) + numbers precomputed in code ─► Level 2 answers
```

The model is used where it adds the most value: reading messy, tilted, partly-Urdu bill images and writing
plain-English explanations. Everything that must be exact (the guide's formatting rules, arithmetic, counting)
is done in code.

1. **Read the bill** (`src/lib/extract.ts`). The image is sent to Gemini at high media resolution with a strict
   JSON response schema. The model only transcribes what is printed: every charge and tax line (label, section,
   type, amount), dates, readings, totals, late-payment amounts, usage history and billing history. The prompt
   explains each layout (K-Electric bill calculation table, LESCO/IESCO "bill charges breakdown"), net metering,
   Urdu labels and `CR` credits. Personal identifiers are not part of the schema, so they are never extracted.
2. **Apply the guide's rules in code** (`toLevel1`):
   - provider from the file name (`KESC` → `KE`, `LESCO`, `IESCO`);
   - lines printed as 0 or blank are skipped; repeated types stay separate; subsidies are negative;
   - subtotal rows go to `total_charges` / `total_taxes`, never into the lists;
   - a single combined tax amount gives `taxes: []` with the amount in `total_taxes`;
   - `payable_after_due_date` is the highest late-payment amount;
   - a dropped `CR` sign is detected from current bill + arrears;
   - readings that cannot explain the billed units (several meter rows) become `null`;
   - invalid dates or numbers become `null`, and the 18 fields are always output in the guide's order.
3. **Self-consistency** (`decodeBill`, `checkConsistency`). Each bill is read twice independently. If the two
   Level 1 results differ, a third reading is made, given the failed checks as feedback (readings vs units,
   lines vs subtotals, charges + taxes vs current bill, 12-month history), and every field is decided by
   majority vote. Random misreads rarely repeat, so voting removes most of them.
4. **Answer questions** (`src/lib/answer.ts`, `src/lib/stats.ts`). The 12 questions for a bill are answered in
   one conversation. Code precomputes the common numbers (averages, highest/lowest month, month-to-month and
   year-on-year changes, tax and charge percentages, cost per unit, late-payment difference, days to due date).
   For anything else the model must call a tool: `calculate` (arithmetic evaluated with `mathjs`) or
   `history_months` (exact filtering and counting of usage months). The prompt requires answers grounded only in
   the bill, clearly labelled estimates with the method, a stated interpretation for ambiguous questions, no
   personal identifiers, and English only.
5. **Reliability** (`src/lib/llm.ts`, `scripts/decode.ts`). Requests are spaced for the 15 requests/minute
   limit; temporary errors (429, 503) are retried with backoff; results are cached per bill; a bill that cannot
   be read still gets a valid JSON row with every field `null`; a question the model skips is asked again, and
   only then gets a clear fallback answer, so no `json` or `answer` cell is ever empty.

## Tests and accuracy check

```
npm test                                                        # unit tests for the code rules (no API calls)
npm run compare -- output/train/level1.csv data/sample/expected # field-by-field score of a Level 1 run
```

`data/sample/expected/` holds hand-checked Level 1 JSON for the five training bills (KESC_0008 is the guide's
worked example). `compare` scores like the guide: text and dates exact, numbers within ±1. Result on the
training bills: **90/90 fields correct**.

## Project structure

| Path | Purpose |
|---|---|
| `scripts/decode.ts` | Command-line run: bill folder + CSV templates → `output/level1.csv`, `output/level2.csv` |
| `src/lib/llm.ts` | The only module that calls the model: rate limiting, retries, JSON parsing |
| `src/lib/extract.ts` | Level 1: prompt, response schema, code rules, consistency checks, voting |
| `src/lib/answer.ts` | Level 2: prompt and tool loop (`calculate`, `history_months`) |
| `src/lib/stats.ts` | Numbers precomputed in code for Level 2 |
| `src/lib/types.ts` | Shared types and the allowed charge and tax types |
| `src/app/` | Web demo: page (`page.tsx`) and API routes (`api/decode`, `api/ask`) |
| `tests/extract.test.ts` | Unit tests |
| `scripts/compare.ts` | Scores a `level1.csv` against expected JSON |
| `scripts/test-api.mjs` | Checks the API key with one call |
| `scripts/make-submission.ps1` | Builds the submission ZIP and checks it |
| `data/train/csv/`, `data/sample/expected/` | Practice templates and expected results for the training bills |

## Environment variables

`.env.example` lists every variable the code reads:

| Variable | Value | Purpose |
|---|---|---|
| `MODEL_PROVIDER` | `google` | Model provider |
| `MODEL_NAME` | `gemini-3.5-flash-lite` | Model ID used by the provider's API |
| `API_KEY` | `your-api-key-here` | Google AI Studio API key (secret, never committed) |
| `MIN_REQUEST_GAP_MS` | `4500` | Optional: minimum gap between model requests in ms |

## AI usage

| Category | Used |
|---|---|
| **Models** | Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`), Google. Reads the bill images (Level 1) and writes the answers (Level 2). No other model is called. |
| **APIs** | Google Gemini API (Google AI Studio), through the official `@google/genai` SDK |
| **Services** | none (no OCR services, invoice or receipt extraction services, or Azure services) |
| **Local OCR libraries** | none |
| **AI tools used to write the code** | Claude Code (Anthropic, model Claude Opus 5.5), used as a coding assistant to design, write and review the code |
