// POST /api/ask  { prompt: string, system?: string }  ->  { reply, model }
// Like a Spring @PostMapping controller: the browser calls this, and only
// this server code talks to Gemini.
import { ask, MODEL } from "@/lib/gemini";

export async function POST(request: Request) {
  const { prompt, system } = await request.json();

  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    const reply = await ask(prompt, system);
    return Response.json({ reply, model: MODEL });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
