"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResultPane } from "@/components/ez/ResultPane";
import { SpecListModal } from "@/components/ez/SpecEditor";
import { StepBasic } from "@/components/ez/steps/StepBasic";
import { StepDrawing } from "@/components/ez/steps/StepDrawing";
import { StepFloor } from "@/components/ez/steps/StepFloor";
import { StepResult } from "@/components/ez/steps/StepResult";
import { StepTop } from "@/components/ez/steps/StepTop";
import { StepWalls } from "@/components/ez/steps/StepWalls";
import { AppFrame } from "@/components/ez/ui";
import { buildWorkbook } from "@/lib/excel";
import { applyExtraction } from "@/lib/extract/toProject";
import { calculate } from "@/lib/gaihi/calc";
import type { Project, SpecKind } from "@/lib/gaihi/types";
import { safeFileName } from "@/lib/format";
import { downloadBlob, downloadText, getProject, saveProject } from "@/lib/store";

const STEPS = [
  { key: "drawing", label: ["図面", "読込"] },
  { key: "basic", label: ["基本"] },
  { key: "walls", label: ["外壁", "窓"] },
  { key: "floor", label: ["床・基礎", "玄関土間"] },
  { key: "top", label: ["天井・屋根", "換気"] },
  { key: "result", label: ["結果", "表示"] },
] as const;
type Step = (typeof STEPS)[number]["key"];

const ALL_KINDS: SpecKind[] = ["ceiling", "roof", "wall", "floor", "baseWall", "doma", "window", "door", "perimeter"];

function Editor() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id") ?? "";
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [step, setStep] = useState<Step>((params.get("step") as Step) || "basic");
  const [saveError, setSaveError] = useState(false);
  const [specList, setSpecList] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const p = getProject(id) ?? null;
    setProject(p);
    // 入力が空の新規物件は図面読込から始める
    if (p && !params.get("step") && p.surfaces.length === 0) setStep("drawing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <AppFrame title="外皮性能計算プログラム">
        <div className="ez-list-wrap">
          <div className="notice bad">物件が見つかりません。</div>
          <button className="ez-btn" onClick={() => router.push("/")}>
            <span className="label">物件一覧へ</span>
          </button>
        </div>
      </AppFrame>
    );
  }

  const openReport = (mode?: "app") => window.open(`/project/report?id=${project.id}${mode ? `&mode=${mode}` : ""}`, "_blank");

  return (
    <AppFrame
      title="外皮性能計算プログラム"
      headerRight={
        <select
          className="ez-select"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "specs") setSpecList(true);
            if (v === "list") router.push("/");
            if (v === "help") window.open("https://github.com/masahiro20/masa/blob/main/gaihi/README.md", "_blank");
          }}
        >
          <option value="">メニュー・仕様リスト</option>
          <option value="specs">仕様リスト（登録・編集）</option>
          <option value="list">物件一覧へ戻る</option>
          <option value="help">使い方（README）</option>
        </select>
      }
    >
      {saveError && <div className="notice bad">ブラウザに保存できませんでした。「保存」でファイル（JSON）に保存してください。</div>}
      <main className="ez-main">
        <div style={flash ? { opacity: 0.4, transition: "opacity .15s" } : { transition: "opacity .3s" }}>
          <ResultPane
            project={project}
            result={result}
            onSave={() => downloadText(`${safeFileName(project.name)}.json`, JSON.stringify(project, null, 2))}
            onPrint={() => openReport()}
            onApplicationPrint={() => openReport("app")}
            onRecalc={() => {
              update(() => undefined);
              setFlash(true);
              setTimeout(() => setFlash(false), 200);
            }}
            onExport={async () => downloadBlob(`${safeFileName(project.name)}_外皮計算.xlsx`, await buildWorkbook(project))}
            onEdit={() => setStep("basic")}
          />
        </div>
        <aside className="ez-right">
          <nav className="ez-steps">
            {STEPS.map((s) => (
              <button key={s.key} className={step === s.key ? "on" : ""} onClick={() => setStep(s.key)}>
                {s.label.map((l, i) => (
                  <span key={i} style={{ display: "block" }}>
                    {l}
                  </span>
                ))}
              </button>
            ))}
          </nav>
          <div className="ez-panel-body">
            {step === "drawing" && (
              <StepDrawing
                project={project}
                onApply={(ex) => update((p) => Object.assign(p, applyExtraction(p, ex)))}
                onShowReport={() => openReport()}
                onShowDetail={() => setStep("walls")}
              />
            )}
            {step === "basic" && <StepBasic project={project} update={update} />}
            {step === "walls" && <StepWalls project={project} update={update} />}
            {step === "floor" && <StepFloor project={project} update={update} />}
            {step === "top" && <StepTop project={project} update={update} result={result} />}
            {step === "result" && <StepResult project={project} result={result} />}
          </div>
        </aside>
      </main>
      {specList && <SpecListModal project={project} update={update} kinds={ALL_KINDS} currentId="" onSelect={() => undefined} onClose={() => setSpecList(false)} />}
    </AppFrame>
  );
}

export default function ProjectPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
