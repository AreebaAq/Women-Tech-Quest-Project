// POST /api/decode  (multipart form, field "bill" = image)  ->  DecodedBill
// Same extraction as the batch CLI, for the web demo.
import { decodeBill, mimeTypeFor } from "@/lib/extract";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("bill");
  if (!(file instanceof File) || !file.size) {
    return Response.json({ error: "Upload a bill image (PNG or JPG)." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image is larger than 10 MB." }, { status: 400 });
  }

  const billId = file.name.replace(/\.[^.]+$/, "");
  const mimeType = file.type.startsWith("image/") ? file.type : mimeTypeFor(file.name);
  try {
    const decoded = await decodeBill(billId, Buffer.from(await file.arrayBuffer()), mimeType);
    return Response.json(decoded);
  } catch (err) {
    return Response.json({ error: `Could not read the bill: ${(err as Error).message}` }, { status: 502 });
  }
}
