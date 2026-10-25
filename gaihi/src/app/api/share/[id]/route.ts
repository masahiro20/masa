import { NextResponse } from "next/server";
import { loadShare, SHARE_ID, shareStoreEnabled } from "@/lib/shareStore";

export const runtime = "nodejs";

/** 短い共有リンクの中身（物件データ）を返す。預けたデータは書き換えないのでキャッシュしてよい */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SHARE_ID.test(id)) return NextResponse.json({ error: "リンクが正しくありません" }, { status: 404 });
  if (!shareStoreEnabled()) return NextResponse.json({ error: "共有リンクの保存先が設定されていません" }, { status: 503 });
  const json = await loadShare(id).catch((e) => {
    console.error("share load failed", e);
    return null;
  });
  if (json === null) return NextResponse.json({ error: "リンクの物件が見つかりません" }, { status: 404 });
  return new Response(json, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=86400" } });
}
