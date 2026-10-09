// Thin wrapper around Gemini so the rest of the app only calls ask().
// "server-only" makes the build fail if this file is ever imported into
// browser code, so the API key can't leak to the client.
import "server-only";
import { GoogleGenAI } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "paste-your-key-here") {
      throw new Error("GEMINI_API_KEY is missing. Add it to your .env file.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export async function ask(prompt: string, system?: string): Promise<string> {
  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: system ? { systemInstruction: system } : undefined,
  });
  return response.text ?? "";
}
