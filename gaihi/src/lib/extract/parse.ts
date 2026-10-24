import { ExtractionSchema, type Extraction } from "./schema";

/** Claude の返答テキストから読み取り結果を取り出す（```json ブロックや前後の説明文があってもよい） */
export function parseExtractionText(text: string): Extraction {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = (fenced ? fenced[1] : text).trim();
  if (!body.startsWith("{")) {
    const a = body.indexOf("{");
    const b = body.lastIndexOf("}");
    if (a >= 0 && b > a) body = body.slice(a, b + 1);
  }
  return ExtractionSchema.parse(JSON.parse(body));
}
