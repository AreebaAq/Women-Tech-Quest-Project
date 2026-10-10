// The only module that talks to the LLM. Everything else calls generate().
// Handles the free-tier rate limit (15 requests/min) and retries on
// temporary errors, so a long batch run doesn't fail halfway.
import { GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";

export const MODEL_PROVIDER = process.env.MODEL_PROVIDER || "google";
export const MODEL_NAME = process.env.MODEL_NAME || "gemini-3.5-flash-lite";

// Requests are spaced at least this far apart (60s / 15 requests = 4s, plus margin).
const MIN_GAP_MS = Number(process.env.MIN_REQUEST_GAP_MS || 4500);
const MAX_RETRIES = 5;

let client: GoogleGenAI | null = null;
let lastRequestAt = 0;

function getClient() {
  if (MODEL_PROVIDER !== "google") {
    throw new Error(`MODEL_PROVIDER "${MODEL_PROVIDER}" is not supported. Use "google".`);
  }
  if (!client) {
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey.startsWith("your-") || apiKey === "paste-your-key-here") {
      throw new Error("API_KEY is missing. Add it to your .env file.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForSlot() {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function isRetryable(err: unknown) {
  const msg = String((err as Error)?.message ?? err);
  return /429|RESOURCE_EXHAUSTED|500|502|503|504|UNAVAILABLE|INTERNAL|DEADLINE|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
}

/** One model call with rate limiting and retries. Returns the raw response. */
export async function generate(contents: Content[] | string, config: GenerateContentConfig = {}) {
  for (let attempt = 1; ; attempt++) {
    await waitForSlot();
    try {
      return await getClient().models.generateContent({
        model: MODEL_NAME,
        contents,
        config: { temperature: 0, ...config },
      });
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isRetryable(err)) throw err;
      const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
      console.warn(`  model call failed (attempt ${attempt}), retrying in ${backoff / 1000}s: ${(err as Error).message?.slice(0, 120)}`);
      await sleep(backoff);
    }
  }
}

/** Parses a JSON reply, tolerating ```json fences or text around the object. */
export function parseJson<T>(text: string | undefined): T {
  if (!text) throw new Error("Empty model response");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error(`Model did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }
}
