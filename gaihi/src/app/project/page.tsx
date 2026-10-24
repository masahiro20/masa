"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Formula, ResultTable } from "@/components/ResultTable";
import { AutoInput } from "@/components/editor/AutoInput";
import { OpeningsEditor } from "@/components/editor/OpeningsEditor";
import { PerimetersEditor } from "@/components/editor/PerimetersEditor";
import { ProjectInfo } from "@/components/editor/ProjectInfo";
import { SpecsEditor } from "@/components/editor/SpecsEditor";
import { Summary } from "@/components/editor/Summary";
import { SurfacesEditor } from "@/components/editor/SurfacesEditor";
import { buildWorkbook } from "@/lib/excel";
import { applyExtraction } from "@/lib/extract/toProject";
import { calculate } from "@/lib/gaihi/calc";
import type { Project } from "@/lib/gaihi/types";
import { safeFileName } from "@/lib/format";
import { downloadBlob, downloadText, getProject, saveProject } from "@/lib/store";

const TABS = [
  { key: "auto", label: "図面から自動入力" },
  { key: "info", label: "物件情報" },
  { key: "specs", label: "仕様（U値）" },
  { key: "surfaces", label: "外皮面積" },
  { key: "openings", label: "開口部" },
  { key: "perimeters", label: "土間外周" },
  { key: "detail", label: "計算明細" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Editor() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") ?? "";
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "surfaces");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setProject(getProject(id) ?? null);
  }, [id]);

  // 連続した編集でも最新の状態から積み上げるため、最新値を ref でも持つ
  const latest = useRef<Project | null | undefined>(undefined);
  latest.current = project;
  const update = useCallback((fn: (p: Project) => void) => {
    const prev = latest.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next);
    next.updatedAt = new Date().toISOString();
    latest.current = next;
    setProject(next);
    setSaveError(!saveProject(next));
  }, []);

  const result = useMemo(() => (project ? calculate(project) : null), [project]);

  if (project === undefined) return null;
  if (project === null || !result) {
    return (
      <main className="container">
        <div className="notice bad">物件が見つかりません。</div>
        <button className="btn" onClick={() => router.push("/")}>
          物件一覧へ
        </button>
      </main>
    );
  }

  const count: Partial<Record<Tab, number>> = {
    surfaces: project.surfaces.length,
    openings: project.openings.length,
    perimeters: project.perimeters.length,
    specs: project.specs.length,
  };
  const openReport = () => window.open(`/project/report?id=${project.id}`, "_blank");

  return (
    <>
      <TopBar>
        <span className="muted">{project.name}</span>
      </TopBar>
      <main className="container">
        {saveError && <div className="notice bad">ブラウザに保存できませんでした。「物件データを保存（JSON）」でファイルに保存してください。</div>}
        <div className="layout">
          <nav className="sidenav">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
                {t.label}
                {count[t.key] !== undefined && <span className="count">{count[t.key]}</span>}
              </button>
            ))}
          </nav>
          <div>
            {tab === "auto" && (
              <AutoInput
                project={project}
                onApply={(ex) => update((p) => Object.assign(p, applyExtraction(p, ex)))}
                onShowReport={openReport}
                onShowDetail={() => setTab("surfaces")}
              />
            )}
            {tab === "info" && <ProjectInfo project={project} update={update} />}
            {tab === "specs" && <SpecsEditor project={project} update={update} />}
            {tab === "surfaces" && <SurfacesEditor project={project} update={update} />}
            {tab === "openings" && <OpeningsEditor project={project} update={update} />}
            {tab === "perimeters" && <PerimetersEditor project={project} update={update} />}
            {tab === "detail" && (
              <section className="panel">
                <div className="panel-head">
                  <h2>計算明細</h2>
                </div>
                <div className="table-wrap">
                  <ResultTable result={result} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Formula result={result} />
                </div>
              </section>
            )}
          </div>
          <Summary
            result={result}
            region={project.region}
            onReport={openReport}
            onExcel={async () => downloadBlob(`${safeFileName(project.name)}_外皮計算.xlsx`, await buildWorkbook(project))}
            onJson={() => downloadText(`${safeFileName(project.name)}.json`, JSON.stringify(project, null, 2))}
          />
        </div>
      </main>
    </>
  );
}

export default function ProjectPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
