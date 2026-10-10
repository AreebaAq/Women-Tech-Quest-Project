// Level 2: answer customer questions about one bill.
// The model writes the answers; arithmetic comes from code (computeStats)
// or from the calculate tool, never from the model's head.
import { FunctionCallingConfigMode, Type, type Content, type FunctionDeclaration } from "@google/genai";
import { evaluate } from "mathjs";
import { generate, parseJson } from "./llm";
import { computeStats } from "./stats";
import type { DecodedBill } from "./types";

export interface Question {
  question_id: string;
  question: string;
}

const MAX_TOOL_ROUNDS = 4;

const CALCULATE: FunctionDeclaration = {
  name: "calculate",
  description:
    "Evaluates arithmetic expressions exactly. Use it for every number you compute that is not already in PRECOMPUTED. " +
    "Send several expressions at once. Example: [\"(3716-3430)/3430*100\", \"mean(141,138,197)\"]. Supports + - * / ^ ( ) mean, sum, min, max, round.",
  parameters: {
    type: Type.OBJECT,
    properties: { expressions: { type: Type.ARRAY, items: { type: Type.STRING } } },
    required: ["expressions"],
  },
};

const HISTORY_MONTHS: FunctionDeclaration = {
  name: "history_months",
  description:
    "Filters the bill's monthly usage history exactly and returns the matching months, their units and the count. " +
    "Use it for every question that counts or lists months (above/below a number of units, highest/lowest N, etc.).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      above: { type: Type.NUMBER, description: "Only months with units strictly greater than this" },
      below: { type: Type.NUMBER, description: "Only months with units strictly less than this" },
      include_current: { type: Type.BOOLEAN, description: "Also consider the current bill month" },
    },
  },
};

function historyMonths(bill: DecodedBill, args: Record<string, unknown> = {}) {
  const months = bill.facts.usage_history
    .filter((h): h is { month: string; units: number } => h.units !== null)
    .map((h) => ({ month: h.month, units: h.units }));
  if (args.include_current && bill.level1.units_consumed !== null) {
    months.push({ month: `${bill.level1.bill_month ?? "current"} (current month)`, units: bill.level1.units_consumed });
  }
  const above = typeof args.above === "number" ? args.above : null;
  const below = typeof args.below === "number" ? args.below : null;
  const matches = months.filter((m) => (above === null || m.units > above) && (below === null || m.units < below));
  return { months_considered: months.length, count: matches.length, matches };
}

const DATE_MATH: FunctionDeclaration = {
  name: "date_math",
  description:
    "Exact date arithmetic. Give a start date (YYYY-MM-DD) and either a number of days to add (negative to subtract) " +
    "or an end date to count days to. Use it for any question about paying on/after a date or days between dates.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      start: { type: Type.STRING, description: "YYYY-MM-DD" },
      add_days: { type: Type.NUMBER },
      end: { type: Type.STRING, description: "YYYY-MM-DD" },
    },
    required: ["start"],
  },
};

function dateMath(args: Record<string, unknown> = {}) {
  const start = Date.parse(`${args.start}T00:00:00Z`);
  if (Number.isNaN(start)) return { error: "start must be YYYY-MM-DD" };
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return { date: d.toISOString().slice(0, 10), weekday: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) };
  };
  if (typeof args.add_days === "number") return fmt(start + args.add_days * 86_400_000);
  const end = Date.parse(`${args.end}T00:00:00Z`);
  if (Number.isNaN(end)) return { error: "give add_days or an end date (YYYY-MM-DD)" };
  return { days: Math.round((end - start) / 86_400_000) };
}

const SUBMIT_ANSWERS: FunctionDeclaration = {
  name: "submit_answers",
  description: "Hand in the final answers, one per question, once all numbers are known. Call this exactly once.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      answers: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question_id: { type: Type.STRING },
            question: { type: Type.STRING, description: "The question text, copied exactly" },
            answer: { type: Type.STRING },
          },
          required: ["question_id", "question", "answer"],
          propertyOrdering: ["question_id", "question", "answer"],
        },
      },
    },
    required: ["answers"],
  },
};

function calculate(expressions: unknown) {
  const list = Array.isArray(expressions) ? expressions : [expressions];
  return list.map((expr) => {
    try {
      const value = evaluate(String(expr));
      return { expression: String(expr), result: typeof value === "number" ? Math.round(value * 10000) / 10000 : String(value) };
    } catch (err) {
      return { expression: String(expr), error: (err as Error).message };
    }
  });
}

const ANSWER_RULES = `You are a helpful assistant explaining a customer's Pakistani electricity bill in plain English.
You get the data read from ONE bill (BILL DATA), numbers already calculated from it (PRECOMPUTED), and the customer's questions.

Rules for every answer:
- Get the numbers right. Use PRECOMPUTED values when they fit. For any other calculation call the calculate tool. For counting or listing months by usage call the history_months tool. For dates (e.g. "if I pay 5 days late") call date_math, then use PRECOMPUTED.money.late_payment_schedule: it gives the exact date range and the number of days late covered by each late amount (e.g. "5 days late" falls in "4 or more days late"). Give the single amount that applies. Never do arithmetic, counting or date maths in your head.
- Ground every answer in this bill only. Never use outside tariff rates, slab prices or amounts. If the bill does not show a needed value, say clearly that the bill does not show it, instead of guessing.
- You may explain what a bill term means in general words, then give this bill's figure. E.g. FPA/FCA = fuel price (cost) adjustment, a charge or credit for the difference between the expected and actual fuel cost of generating electricity in an earlier month; QTA = quarterly tariff adjustment; arrears = unpaid amount carried from earlier bills (negative = credit); LP surcharge = late payment surcharge; sanctioned load = the maximum load approved for the connection.
- Negative units in the history (net metering connections) mean more electricity was exported to the grid than imported that month. Say so when they affect an answer, and for counts/averages state how negative months were treated.
- Label estimates: any projected or hypothetical figure must use the word "estimate" and explain how it was calculated (e.g. "This is an estimate: 181.2 units x your average cost of PKR 22.72 per unit on this bill"). Mention that the real bill can differ because slab rates, taxes and adjustments change.
- When the bill prints several amounts for the same thing (e.g. different late-payment amounts by date), mention each of them.
- If a question can reasonably mean two things (e.g. including or excluding the current month), state the meaning you used or answer both.
- Be specific: quote the exact PKR amounts, units, months and dates from the bill. Write amounts like "PKR 3,430.24".
- Never mention names, addresses, CNIC, account, reference, consumer or meter numbers.
- Answer in English, 1-4 sentences, even if the bill is partly in Urdu. No markdown.
- Do not speculate about why something is missing from the bill; just say the bill does not show it.
- Never mention data field names, JSON, null, "PRECOMPUTED" or tools. Write as if you read the bill yourself.
- For trend, season, "last 12 months", "next month" and budgeting questions use PRECOMPUTED.trends and PRECOMPUTED.budgeting. State which months you used and whether the current bill month is included.
- For "how many units should I expect next month" give PRECOMPUTED.trends.next_month_estimate_inputs.best_estimate as the single answer: say it is an estimate, explain its method, and mention the range of the other inputs.
- If the bill shows fewer months than the question asks about (e.g. only 3 months of payments), say how many months the bill shows and answer for those.
- For payment-history questions use PRECOMPUTED.billing_history_check: paid more than billed is an overpayment, not a partial payment.

Example answers (another bill):
Q: How much of my bill is taxes?
A: Taxes and duties total PKR 569.62 out of your current bill of PKR 3,430.24, or about 16.6%. The bill shows a split of 83.39% energy charges and 16.61% taxes. The tax lines are sales tax (PKR 520.21), electricity duty (PKR 29.41), and MUCT (KMC) (PKR 20.00).
Q: How many months in my history went above 200 units?
A: Two of the 12 previous months exceeded 200 units: July 2025 (239) and August 2025 (203). The current month used 151 units, so the count is two whether or not the current month is included.

When you have all the numbers, call submit_answers once with one answer per question, in the same order.`;

/** Bill data for the prompt, without the model's raw notes on hard-to-read areas. */
// Missing values are shown as text, so answers never talk about "null".
const NOT_SHOWN = "not shown on the bill";
const readable = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_k, x) => (x === null ? NOT_SHOWN : x)));

function billData(bill: DecodedBill) {
  const { lines, usage_history, billing_history, late_payment_amounts, other_details } = bill.facts;
  return readable({
    level1: bill.level1,
    printed_lines: lines.filter((l) => l.amount !== null && l.amount !== 0),
    usage_history_oldest_first: usage_history,
    billing_history,
    late_payment_amounts,
    other_details,
  });
}

export async function answerQuestions(bill: DecodedBill, questions: Question[]): Promise<Map<string, string>> {
  const stats = computeStats(bill.level1, bill.facts);
  const prompt =
    `${ANSWER_RULES}\n\nBILL DATA:\n${JSON.stringify(billData(bill))}\n\nPRECOMPUTED:\n${JSON.stringify(readable(stats))}\n\n` +
    `QUESTIONS:\n${questions.map((q) => `${q.question_id}: ${q.question}`).join("\n")}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const answers = new Map<string, string>();
  // Answers are matched to questions by the echoed question text, so a shifted
  // question_id can never put an answer on the wrong row.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byText = new Map(questions.map((q) => [norm(q.question), q.question_id]));
  const ids = new Set(questions.map((q) => q.question_id));
  const collect = (args: unknown) => {
    const list = (args as { answers?: { question_id?: unknown; question?: unknown; answer?: unknown }[] })?.answers ?? [];
    for (const a of list) {
      if (typeof a?.answer !== "string" || !a.answer.trim()) continue;
      const idFromText = typeof a.question === "string" ? byText.get(norm(a.question)) : undefined;
      const id = idFromText ?? (typeof a.question_id === "string" && ids.has(a.question_id.trim()) ? a.question_id.trim() : undefined);
      if (id && !answers.has(id)) answers.set(id, a.answer.trim());
    }
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round the model must hand in its answers.
    const lastRound = round === MAX_TOOL_ROUNDS;
    const response = await generate(contents, {
      tools: [{ functionDeclarations: [CALCULATE, HISTORY_MONTHS, DATE_MATH, SUBMIT_ANSWERS] }],
      toolConfig: {
        functionCallingConfig: lastRound
          ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["submit_answers"] }
          : { mode: FunctionCallingConfigMode.AUTO },
      },
    });
    const calls = response.functionCalls ?? [];
    const submit = calls.find((c) => c.name === "submit_answers");
    if (submit) {
      collect(submit.args);
      break;
    }
    if (!calls.length) {
      // The model answered in text instead of calling submit_answers: accept it if it is valid JSON.
      try {
        collect(parseJson(response.text));
      } catch {
        // Nothing usable; the caller re-asks for missing answers.
      }
      break;
    }
    contents.push(response.candidates?.[0]?.content ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });
    contents.push({
      role: "user",
      parts: calls.map((c) => ({
        functionResponse: {
          id: c.id,
          name: c.name,
          response:
            c.name === "history_months"
              ? historyMonths(bill, c.args)
              : c.name === "date_math"
                ? dateMath(c.args)
                : { results: calculate(c.args?.expressions) },
        },
      })),
    });
  }
  return answers;
}
