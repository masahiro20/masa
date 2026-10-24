"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_PAYLOAD_BYTES,
  PAGE_TYPE_LABEL,
  buildPayload,
  inspectFiles,
  payloadSize,
  type DrawingFile,
  type DrawingPage,
} from "@/lib/drawings";
import { driveEnabled, pickDriveDrawings } from "@/lib/gdrive";
import type { Extraction } from "@/lib/extract/schema";
import type { Project } from "@/lib/gaihi/types";

type Phase = "select" | "pages" | "reading" | "done";

export function AutoInput({
  project,
  onApply,
  onShowReport,
  onShowDetail,
}: {
  project: Project;
  onApply: (ex: Extraction) => void;
  onShowReport: () => void;
  onShowDetail: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("select");
  const [files, setFiles] = useState<DrawingFile[]>([]);
  const [pages, setPages] = useState<DrawingPage[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Extraction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== "reading") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const addFiles = async (added: DrawingFile[]) => {
    if (added.length === 0) return;
    setError("");
    setBusy("図面を読み込んでいます…");
    try {
      const all = [...files, ...added];
      setFiles(all);
      setPages(await inspectFiles(all));
      setPhase("pages");
    } catch (e) {
      setError(`図面を開けませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const fromLocal = async (list: FileList | null) => {
    if (!list) return;
    const added: DrawingFile[] = [];
    for (const f of Array.from(list)) {
      const mediaType = f.type === "image/png" ? "image/png" : f.type === "image/jpeg" ? "image/jpeg" : f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : null;
      if (!mediaType) {
        setError(`「${f.name}」は読み込めません（PDF・JPEG・PNG のみ）`);
        continue;
      }
      added.push({ name: f.name, mediaType, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    await addFiles(added);
  };

  const fromDrive = async () => {
    setError("");
    try {
      setBusy("Googleドライブから取得しています…");
      const added = await pickDriveDrawings();
      setBusy("");
      await addFiles(added);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async () => {
    if (project.surfaces.length + project.openings.length > 0 && !confirm("入力済みの外皮・開口部・外周部を、図面の読み取り結果で置き換えます。よろしいですか？（部位の仕様は残ります）")) return;
    setError("");
    setBusy("送信する図面を準備しています…");
    try {
      const payload = await buildPayload(files, pages);
      if (payloadSize(payload) > MAX_PAYLOAD_BYTES) {
        setError("選んだページが多すぎて送れません。平面図・立面図・仕様書など必要なページに絞ってください。");
        return;
      }
      setBusy("");
      setPhase("reading");
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const body = await res.json().catch(() => ({ error: `サーバーエラー（${res.status}）` }));
      if (!res.ok || !body.extraction) {
        setError(body.error ?? `読み取りに失敗しました（${res.status}）`);
        setPhase("pages");
        return;
      }
      setResult(body.extraction);
      onApply(body.extraction);
      setPhase("done");
    } catch (e) {
      setError(`読み取りに失敗しました：${e instanceof Error ? e.message : String(e)}`);
      setPhase("pages");
    } finally {
      setBusy("");
    }
  };

  const selectedCount = pages.filter((p) => p.selected).length;
  const stepClass = (s: Phase) => {
    const order: Phase[] = ["select", "pages", "reading", "done"];
    return order.indexOf(s) < order.indexOf(phase) ? "step done" : s === phase ? "step on" : "step";
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>図面から自動入力</h2>
      </div>
      <div className="steps">
        <span className={stepClass("select")}>1. 図面を選ぶ</span>
        <span className={stepClass("pages")}>2. 使うページを確認</span>
        <span className={stepClass("reading")}>3. AI が読み取り</span>
        <span className={stepClass("done")}>4. 結果を確認・出力</span>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {busy && (
        <div className="notice info btn-row">
          <span className="spinner" /> {busy}
        </div>
      )}

      {(phase === "select" || phase === "pages") && (
        <>
          <div
            className={`dropzone${over ? " over" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              fromLocal(e.dataTransfer.files);
            }}
          >
            <b>設計図書の PDF（製本図面一式でも可）や図面の画像をここにドロップ</b>
            <div className="muted small">またはクリックして選択。平面図・立面図・仕様書（断熱材・サッシ）・矩計図があると精度が上がります。</div>
            <input ref={inputRef} type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => fromLocal(e.target.files)} />
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            {driveEnabled ? (
              <button className="btn" onClick={fromDrive}>
                Googleドライブから選ぶ
              </button>
            ) : (
              <span className="muted small">Googleドライブ連携は未設定です（README の手順で有効にできます）。ドライブからダウンロードした PDF をドロップしても使えます。</span>
            )}
          </div>
        </>
      )}

      {phase === "pages" && (
        <>
          <div className="panel-head" style={{ marginTop: 16 }}>
            <h3 style={{ margin: 0 }}>
              使うページ（{selectedCount} / {pages.length}）
            </h3>
            <span className="muted small">図面名から自動で選んでいます。クリックで切り替え。</span>
            <div className="spacer" />
            <button
              className="btn small"
              onClick={() => {
                setFiles([]);
                setPages([]);
                setPhase("select");
              }}
            >
              図面を選び直す
            </button>
            <button className="btn primary" disabled={selectedCount === 0 || Boolean(busy)} onClick={run}>
              この図面で一発計算
            </button>
          </div>
          <div className="pages">
            {pages.map((p) => (
              <div
                key={p.key}
                className={`page-card${p.selected ? " on" : ""}`}
                onClick={() => setPages((ps) => ps.map((x) => (x.key === p.key ? { ...x, selected: !x.selected } : x)))}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbnail} alt={`${p.fileName} ${p.pageNumber}ページ`} />
                <div>
                  <input type="checkbox" readOnly checked={p.selected} /> {PAGE_TYPE_LABEL[p.type]}
                </div>
                <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.fileName}
                  {p.pageNumber > 0 ? ` p.${p.pageNumber}` : ""}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {phase === "reading" && (
        <div className="notice info btn-row" style={{ padding: 20 }}>
          <span className="spinner" />
          <div>
            <b>AI が図面を読み取っています（{elapsed} 秒）</b>
            <div className="small">通り芯・寸法線・建具から方位別の面積を拾っています。図面の量によって 1〜4 分ほどかかります。</div>
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <>
          <div className="notice info">
            読み取り完了：外壁 {result.walls.length} 面・開口部 {result.openings.reduce((a, o) => a + o.count, 0)} か所・天井/屋根 {result.ceilings.length} 面・床{" "}
            {result.floors.length} 面・土間 {result.domas.length} か所を入力し、計算しました。
          </div>
          {result.warnings.length > 0 && (
            <div className="notice warn">
              <b>要確認（AI が推定した・読めなかった項目）</b>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="btn-row">
            <button className="btn primary" onClick={onShowReport}>
              計算書を開く
            </button>
            <button className="btn" onClick={onShowDetail}>
              拾いの明細を確認する
            </button>
            <button className="btn" onClick={() => setPhase("pages")}>
              ページを変えて読み直す
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            AI の読み取り結果は必ず図面と照合してください。各行の「根拠」に拾いの計算式が入っています。
          </p>
        </>
      )}
    </section>
  );
}
