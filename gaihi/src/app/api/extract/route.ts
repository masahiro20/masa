import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EXTRACTION_SYSTEM, extractionInstruction } from "@/lib/extract/prompt";
import { ExtractionSchema, extractionJsonSchema } from "@/lib/extract/schema";

export const runtime = "nodejs";
// 図面数枚の読み取りに数分かかることがある
export const maxDuration = 300;

const RequestSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string(),
        mediaType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        data: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

const MODEL = process.env.GAIHI_MODEL || "claude-opus-5-5";

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "サーバーに ANTHROPIC_API_KEY が設定されていません。README の「セットアップ」を参照してください。" },
      { status: 500 },
    );
  }

  const parsedReq = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedReq.success) {
    return NextResponse.json({ error: "図面ファイルが送られていません" }, { status: 400 });
  }
  const { files } = parsedReq.data;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of files) {
    if (f.mediaType === "application/pdf") {
      content.push({
        type: "document",
        title: f.name,
        source: { type: "base64", media_type: "application/pdf", data: f.data },
      });
    } else {
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
    }
  }
  content.push({ type: "text", text: extractionInstruction(files.map((f) => f.name)) });

  const client = new Anthropic();
  try {
    const message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: extractionJsonSchema() },
        },
        system: EXTRACTION_SYSTEM,
        messages: [{ role: "user", content }],
      })
      .finalMessage();

    if (message.stop_reason === "refusal") {
      return NextResponse.json({ error: "AI が図面の読み取りを断りました。別の図面で試してください。" }, { status: 422 });
    }
    if (message.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "読み取り結果が長すぎて途中で切れました。図面のページを絞って再実行してください。" }, { status: 422 });
    }

    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "読み取り結果を解析できませんでした。もう一度実行してください。" }, { status: 502 });
    }
    const extraction = ExtractionSchema.safeParse(json);
    if (!extraction.success) {
      return NextResponse.json({ error: "読み取り結果の形式が想定と違いました。もう一度実行してください。" }, { status: 502 });
    }
    return NextResponse.json({ extraction: extraction.data, model: message.model, usage: message.usage });
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) {
      return NextResponse.json({ error: `図面を送れませんでした（${error.message}）。ページ数やファイルサイズを減らしてください。` }, { status: 400 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "API キーが無効です。" }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "混み合っています。少し待ってから再実行してください。" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI の呼び出しに失敗しました（${error.status ?? "接続エラー"}）。` }, { status: 502 });
    }
    throw error;
  }
}
