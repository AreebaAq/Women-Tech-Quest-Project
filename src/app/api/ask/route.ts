// POST /api/ask  { bill: DecodedBill, questions: string[] }  ->  { answers: string[] }
// Like a Spring @PostMapping controller: the browser calls this, and only
// server code talks to the model.
import { answerQuestions } from "@/lib/answer";
import type { DecodedBill } from "@/lib/types";

export async function POST(request: Request) {
  const { bill, questions } = (await request.json()) as { bill?: DecodedBill; questions?: string[] };
  const list = (questions ?? []).map((q) => String(q).trim()).filter(Boolean);

  if (!bill?.level1 || !bill?.facts) {
    return Response.json({ error: "Decode a bill first." }, { status: 400 });
  }
  if (!list.length) {
    return Response.json({ error: "Ask at least one question." }, { status: 400 });
  }

  try {
    const qs = list.map((question, i) => ({ question_id: `Q${i + 1}`, question }));
    const answers = await answerQuestions(bill, qs);
    return Response.json({
      answers: qs.map((q) => answers.get(q.question_id) ?? "Sorry, no answer was returned for this question. Please try again."),
    });
  } catch (err) {
    return Response.json({ error: `Could not answer: ${(err as Error).message}` }, { status: 502 });
  }
}
