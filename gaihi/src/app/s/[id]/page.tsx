"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";
import { ImportScreen } from "@/components/ImportScreen";
import type { Project } from "@/lib/gaihi/types";

// 短い共有リンク（/s/<ID>）の受け口。預けてある物件データを取り出して複製を作る
export default function SharedPage() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(async () => {
    const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? "リンクの物件データを読み込めませんでした。");
    return body as Project;
  }, [id]);
  return <ImportScreen load={load} />;
}
