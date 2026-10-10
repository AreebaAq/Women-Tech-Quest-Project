# Utility Bill Decoder

Reads K-Electric, LESCO and IESCO electricity bill images, extracts the billing details as JSON (Level 1),
and answers customer questions about each bill in plain English (Level 2).

- **Model:** Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`)
- **Runtime:** Node.js 24 (any Node.js 22 or later works)

## Dependencies

Pinned in `package.json` and locked in `package-lock.json`: `@google/genai` 2.28.0 (Gemini SDK),
`csv-parse` 7.0.3, `csv-stringify` 6.9.0, `mathjs` 15.2.0, `tsx` 4.23.15, and `next` 16.4.0 with `react` 19.3.0
for the web demo.

## Setup

```
npm install
copy .env.example .env        # macOS/Linux: cp .env.example .env
```

Put your Google AI Studio API key in `.env` (`API_KEY=...`), then check it works:

```
npm run test:api
```

## Generate both CSV files

```
npm run decode -- --bills <path-to-test>/bills --csv <path-to-test>/csv --out output
```

- `--bills`: folder of bill images (`.png` / `.jpg`)
- `--csv`: folder containing the `level1.csv` and `level2.csv` templates
- `--out`: writes `output/level1.csv` and `output/level2.csv`

Takes about 5 minutes for 10 bills on the free tier. Results are cached in `output/cache/`, so an interrupted
run continues where it stopped when the same command is run again (`--fresh` ignores the cache).

## Web demo

```
npm run dev
```

Open http://localhost:3000, upload a bill, click **Decode bill**, then ask questions.

## How it works

The model does what it is best at: reading messy, tilted, partly-Urdu bill images and explaining them in plain
English. Everything that must be exact (the guide's rules, arithmetic, counting) is done in code.

1. **Read:** Gemini reads the bill image (high resolution, strict JSON schema) and transcribes every printed
   charge and tax line, dates, readings, totals, late-payment amounts and usage history. Personal identifiers
   are not in the schema, so they are never extracted.
2. **Apply the guide's rules in code:** provider from the file name (KESC → KE), zero lines skipped, subsidies
   negative, subtotals moved to `total_charges` / `total_taxes`, combined tax amount → `taxes: []`, highest
   late-payment amount, dropped `CR` signs restored, invalid values → `null`, fields in the guide's order.
3. **Self-consistency:** each bill is read twice. If the readings differ, a third reading is made with the
   failed checks as feedback (readings vs units, lines vs subtotals, charges + taxes vs current bill), and each
   field is decided by majority vote.
4. **Answer:** code precomputes the common numbers (averages, comparisons, percentages, cost per unit,
   late-payment schedule by days late, payment status per month). For anything else the model must call tools:
   `calculate` (exact arithmetic), `date_math` (exact dates) and
   `history_months` (exact month filtering and counting). Final answers are handed in through a `submit_answers`
   tool and matched to questions by their text, so an answer can never land on the wrong row. Answers are grounded
   only in the bill, and estimates
   are labelled with the method used.
5. **Reliability:** requests respect the 15 requests/minute limit, temporary errors are retried, and a bill
   or question that fails still gets a valid row, so no CSV cell is ever empty.

## Tests

```
npm test                                                         # unit tests for the code rules
npm run compare -- <level1.csv> data/sample/expected            # score Level 1 against expected JSON
```

On the five training bills: **90/90 Level 1 fields correct**.

## AI usage

| Category | Used |
|---|---|
| **Models** | Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`), for reading the bills (Level 1) and answering questions (Level 2) |
| **APIs** | Google Gemini API (Google AI Studio), via the `@google/genai` SDK |
| **Services** | none |
| **Local OCR libraries** | none |
| **AI tools used to write the code** | Claude (Anthropic) |
