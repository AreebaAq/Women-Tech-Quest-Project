// Checks the API key with one call, without starting the app: npm run test:api
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY;
const model = process.env.MODEL_NAME || "gemini-3.5-flash-lite";

if (!apiKey || apiKey.startsWith("your-") || apiKey === "paste-your-key-here") {
  console.error("API_KEY is missing. Add it to your .env file.");
  process.exit(1);
}

console.log(`Calling ${model} ...`);
const ai = new GoogleGenAI({ apiKey });
const response = await ai.models.generateContent({
  model,
  contents: "Reply with exactly: API key works!",
});
console.log("Reply:", response.text);
