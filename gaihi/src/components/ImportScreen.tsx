"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppFrame } from "@/components/ez/ui";
import { newId, normalizeProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";
import { saveProject } from "@/lib/store";

/** 共有リンク・MCP のリンクの受け口。load で物件データを取り出し、複製として保存して結果画面を開く */
export function ImportScreen({ load }: { load: () => Promise<Project> }) {
  const router = useRouter();
  const [error, setError] = useState("");
  // 開発時の二重実行で2件できないようにする
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load()
      .then((raw) => {
        if (!raw.specs || !raw.surfaces) throw new Error("リンクの物件データを読み込めませんでした。");
        const p = normalizeProject({ ...raw, id: newId("prj") });
        if (!saveProject(p)) throw new Error("ブラウザに保存できませんでした（プライベートブラウズ等では保存できません）。");
        router.replace(`/project?id=${p.id}&step=result`);
      })
      .catch((e) => setError(e instanceof Error && e.message ? e.message : "リンクの物件データを読み込めませんでした。"));
  }, [load, router]);

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
