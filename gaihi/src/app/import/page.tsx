"use client";

import { useCallback } from "react";
import { ImportScreen } from "@/components/ImportScreen";
import { unpackProject } from "@/lib/share";

// 長い共有リンクと MCP の「ツールで開く」リンクの受け口。物件データは URL の # 以降に入っている
export default function ImportPage() {
  const load = useCallback(async () => {
    const packed = new URLSearchParams(window.location.hash.slice(1)).get("p");
    if (!packed) throw new Error("リンクに物件データが入っていません。");
    return unpackProject(packed).catch(() => {
      throw new Error("リンクの物件データを読み込めませんでした。");
    });
  }, []);
  return <ImportScreen load={load} />;
}
