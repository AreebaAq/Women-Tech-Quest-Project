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
- Get the numbers right. Use PRECOMPUTED values when they fit. For any other calculation call the calculate tool. Never do arithmetic in your head.
- Ground every answer in this bill only. Never use outside tariff rates, slab prices or amounts. If the bill does not show a needed value, say clearly that the bill does not show it, instead of guessing.
- You may explain what a bill term means in general words, then give this bill's figure. E.g. FPA/FCA = fuel price (cost) adjustment, a charge or credit for the difference between the expected and actual fuel cost of generating electricity in an earlier month; QTA = quarterly tariff adjustment; arrears = unpaid amount carried from earlier bills (negative = credit); LP surcharge = late payment surcharge; sanctioned load = the maximum load approved for the connection.
- Negative units in the history (net metering connections) mean more electricity was exported to the grid than imported that month. Say so when they affect an answer, and for counts/averages state how negative months were treated.
- Label estimates: any projected or hypothetical figure must use the word "estimate" and explain how it was calculated (e.g. "This is an estimate: 181.2 units x your average cost of PKR 22.72 per unit on this bill"). Mention that the real bill can differ because slab rates, taxes and adjustments change.
- When the bill prints several amounts for the same thing (e.g. different late-payment amounts by date), mention each of them.
- If a question can reasonably mean two things (e.g. including or excluding the current month), state the meaning you used or answer both.
- Be specific: quote the exact PKR amounts, units, months and dates from the bill. Write amounts like "PKR 3,430.24".
- Never mention names, addresses, CNIC, account, reference, consumer or meter numbers.
- Answer in English, 1-4 sentences, even if the bill is partly in Urdu. No markdown.

Example answers (another bill):
Q: How much of my bill is taxes?
A: Taxes and duties total PKR 569.62 out of your current bill of PKR 3,430.24, or about 16.6%. The bill shows a split of 83.39% energy charges and 16.61% taxes. The tax lines are sales tax (PKR 520.21), electricity duty (PKR 29.41), and MUCT (KMC) (PKR 20.00).
Q: How many months in my history went above 200 units?
A: Two of the 12 previous months exceeded 200 units: July 2025 (239) and August 2025 (203). The current month used 151 units, so the count is two whether or not the current month is included.

When you have all the numbers, reply with only this JSON:
{"answers":[{"question_id":"Q1","answer":"..."}, ...]} with one entry per question, in the same order.`;

/** Bill data for the prompt, without the model's raw notes on hard-to-read areas. */
function billData(bill: DecodedBill) {
  const { lines, usage_history, billing_history, late_payment_amounts, other_details } = bill.facts;
  return {
    level1: bill.level1,
    printed_lines: lines.filter((l) => l.amount !== null && l.amount !== 0),
    usage_history_oldest_first: usage_history,
    billing_history,
    late_payment_amounts,
    other_details,
  };
}

export async function answerQuestions(bill: DecodedBill, questions: Question[]): Promise<Map<string, string>> {
  const stats = computeStats(bill.level1, bill.facts);
  const prompt =
    `${ANSWER_RULES}\n\nBILL DATA:\n${JSON.stringify(billData(bill))}\n\nPRECOMPUTED:\n${JSON.stringify(stats)}\n\n` +
    `QUESTIONS:\n${questions.map((q) => `${q.question_id}: ${q.question}`).join("\n")}`;

  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  let text: string | undefined;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    // On the last round the tool stays declared (the history contains calls) but is switched off.
    const response = await generate(contents, {
      tools: [{ functionDeclarations: [CALCULATE] }],
      ...(lastRound && { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }),
    });
    const calls = response.functionCalls ?? [];
    if (!calls.length || lastRound) {
      text = response.text;
      break;
    }
    contents.push(response.candidates?.[0]?.content ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });
    contents.push({
      role: "user",
      parts: calls.map((c) => ({
        functionResponse: { id: c.id, name: c.name, response: { results: calculate(c.args?.expressions) } },
      })),
    });
  }

  const parsed = parseJson<{ answers?: { question_id: string; answer: string }[] }>(text);
  const answers = new Map<string, string>();
  for (const a of parsed.answers ?? []) {
    if (a?.question_id && typeof a.answer === "string" && a.answer.trim()) answers.set(a.question_id.trim(), a.answer.trim());
  }
  return answers;
}
