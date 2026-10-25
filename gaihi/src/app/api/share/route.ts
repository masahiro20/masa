import { NextResponse } from "next/server";
import { MAX_SHARE_BYTES, saveShare, shareStoreEnabled } from "@/lib/shareStore";

export const runtime = "nodejs";

/** 物件データを預けて短い共有リンクの ID を返す。預け先がない環境では 503（画面は長いリンクに切り替える） */
export async function POST(req: Request) {
  if (!shareStoreEnabled()) return NextResponse.json({ error: "共有リンクの保存先が設定されていません" }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_SHARE_BYTES) return NextResponse.json({ error: "物件データが大きすぎます" }, { status: 413 });
  let project: unknown;
  try {
    project = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "物件データを読めませんでした" }, { status: 400 });
  }
  const p = project as { name?: unknown; specs?: unknown; surfaces?: unknown };
  if (!p || typeof p !== "object" || typeof p.name !== "string" || !Array.isArray(p.specs) || !Array.isArray(p.surfaces)) {
    return NextResponse.json({ error: "物件データの形が違います" }, { status: 400 });
  }
  try {
    return NextResponse.json({ id: await saveShare(text) });
  } catch (e) {
    console.error("share save failed", e);
    return NextResponse.json({ error: "共有リンクを保存できませんでした" }, { status: 502 });
  }
}
