"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/ez/ui";
import { newId, normalizeProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";
import { unpackProject } from "@/lib/share";
import { saveProject } from "@/lib/store";

// 「共有リンク」と MCP の「ツールで開く」リンクの受け口。URL の # 以降の物件データを展開し、複製として保存する
export default function ImportPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const packed = new URLSearchParams(window.location.hash.slice(1)).get("p");
    if (!packed) {
      setError("リンクに物件データが入っていません。");
      return;
    }
    unpackProject(packed)
      .then((raw) => {
        if (!raw.specs || !raw.surfaces) throw new Error("bad");
        const p = normalizeProject({ ...raw, id: newId("prj") });
        if (!saveProject(p)) throw new Error("save");
        router.replace(`/project?id=${p.id}&step=result`);
      })
      .catch((e) =>
        setError(e instanceof Error && e.message === "save" ? "ブラウザに保存できませんでした（プライベートブラウズ等では保存できません）。" : "リンクの物件データを読み込めませんでした。"),
      );
  }, [router]);

  return (
    <AppFrame title="物件の取り込み" icon="list">
      <main className="ez-list-wrap">
        {error ? (
          <div className="notice bad">{error}</div>
        ) : (
          <div className="notice info flex">
            <span className="spinner" /> 物件データを取り込んでいます…
          </div>
        )}
      </main>
    </AppFrame>
  );
}
