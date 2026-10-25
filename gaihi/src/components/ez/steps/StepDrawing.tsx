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
import { chatPrompt } from "@/lib/extract/prompt";
import { parseExtractionText } from "@/lib/extract/parse";
import { extractionJsonSchema, type Extraction } from "@/lib/extract/schema";
import { driveEnabled, pickDriveDrawings } from "@/lib/gdrive";
import type { Project } from "@/lib/gaihi/types";
import { EzButton, Section } from "../ui";

type Phase = "select" | "pages" | "reading" | "done";

export function StepDrawing({
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
  const [apiEnabled, setApiEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [files, setFiles] = useState<DrawingFile[]>([]);
  const [pages, setPages] = useState<DrawingPage[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Extraction | null>(null);
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/extract")
      .then((r) => r.json())
      .then((b) => setApiEnabled(Boolean(b.enabled)))
      .catch(() => setApiEnabled(false));
  }, []);

  useEffect(() => {
    if (phase !== "reading") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const confirmOverwrite = () =>
    project.surfaces.length + project.openings.length === 0 ||
    confirm("入力済みの外皮・開口部・外周部を、図面の読み取り結果で置き換えます。よろしいですか？（登録した仕様は残ります）");

  const finish = (ex: Extraction) => {
    setResult(ex);
    onApply(ex);
    setPhase("done");
  };

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
      const lower = f.name.toLowerCase();
      const mediaType =
        f.type === "image/png" ? "image/png" : f.type === "image/jpeg" ? "image/jpeg" : f.type === "application/pdf" || lower.endsWith(".pdf") ? "application/pdf" : null;
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
    if (!confirmOverwrite()) return;
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
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: payload }) });
      const body = await res.json().catch(() => ({ error: `サーバーエラー（${res.status}）` }));
      if (!res.ok || !body.extraction) {
        setError(body.error ?? `読み取りに失敗しました（${res.status}）`);
        setPhase("pages");
        return;
      }
      finish(body.extraction);
    } catch (e) {
      setError(`読み取りに失敗しました：${e instanceof Error ? e.message : String(e)}`);
      setPhase("pages");
    } finally {
      setBusy("");
    }
  };

  const applyPaste = () => {
    setError("");
    let ex: Extraction;
    try {
      ex = parseExtractionText(paste);
    } catch {
      setError("貼り付けた内容を読み取り結果として読めませんでした。Claude の返答の JSON 部分をそのまま貼り付けてください。");
      return;
    }
    if (!confirmOverwrite()) return;
    finish(ex);
    setPaste("");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(chatPrompt(extractionJsonSchema()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("クリップボードにコピーできませんでした。");
    }
  };

  const selectedCount = pages.filter((p) => p.selected).length;

  return (
    <>
      {error && <div className="notice bad">{error}</div>}
      {busy && (
        <div className="notice info flex">
          <span className="spinner" /> {busy}
        </div>
      )}

      {phase === "done" && result && (
        <Section title="読み取り結果">
          <div className="notice info">
            外壁 {result.walls.length} 面・窓/ドア {result.openings.reduce((a, o) => a + o.count, 0)} か所・天井/屋根 {result.ceilings.length} 面・床 {result.floors.length} 面・土間{" "}
            {result.domas.length} か所を入力して計算しました。
          </div>
          {result.warnings.length > 0 && (
            <div className="notice warn">
              <b>要確認（推定した・読めなかった項目）</b>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex">
            <EzButton icon="print" label="計算書を開く" onClick={onShowReport} />
            <EzButton icon="edit" label="拾いを確認・修正" onClick={onShowDetail} />
            <EzButton icon="refresh" label="読み直す" onClick={() => setPhase(pages.length ? "pages" : "select")} />
          </div>
          <p className="ez-note" style={{ marginTop: 8 }}>
            読み取り結果は必ず図面と照合してください。各行の「根拠」に拾いの計算式が入っています。
          </p>
        </Section>
      )}

      <Section title="図面から自動入力（AI 読み取り）">
        {apiEnabled === false && (
          <div className="notice warn">
            このサーバーには Claude の API キーが設定されていないため、ワンクリック読み取りは使えません。下の「Claude に読ませて貼り付け」なら API キーなしで使えます。
          </div>
        )}
        {(phase === "select" || phase === "pages" || phase === "done") && (
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
              <b>設計図書の PDF（製本図面一式でも可）・図面画像をドロップ</b>
              <div className="ez-note">またはクリックして選択。平面図・立面図・仕様書（断熱材・サッシ）・矩計図があると精度が上がります。</div>
              <input ref={inputRef} type="file" multiple hidden accept="application/pdf,image/jpeg,image/png" onChange={(e) => fromLocal(e.target.files)} />
            </div>
            {driveEnabled && (
              <div style={{ marginTop: 8 }}>
                <EzButton icon="upload" label="Googleドライブから選ぶ" onClick={fromDrive} />
              </div>
            )}
          </>
        )}

        {phase === "pages" && (
          <>
            <div className="flex" style={{ marginTop: 12 }}>
              <b>
                使うページ（{selectedCount} / {pages.length}）
              </b>
              <span className="ez-note">図面名から自動で選んでいます。クリックで切り替え。</span>
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
            <div className="flex" style={{ marginTop: 12 }}>
              <EzButton icon="ai" label="この図面で一発計算" dark onClick={run} disabled={selectedCount === 0 || Boolean(busy) || apiEnabled === false} />
              <EzButton
                icon="back"
                label="図面を選び直す"
                onClick={() => {
                  setFiles([]);
                  setPages([]);
                  setPhase("select");
                }}
              />
            </div>
          </>
        )}

        {phase === "reading" && (
          <div className="notice info flex" style={{ padding: 18 }}>
            <span className="spinner" />
            <div>
              <b>AI が図面を読み取っています（{elapsed} 秒）</b>
              <div className="small">通り芯・寸法線・建具から方位別の面積を拾っています。図面の量によって 1〜4 分ほどかかります。</div>
            </div>
          </div>
        )}
      </Section>

      <Section key={String(apiEnabled)} title="Claude に読ませて貼り付け（API キー不要）" defaultOpen={apiEnabled === false}>
        <ol className="small" style={{ paddingLeft: 18, margin: "0 0 10px" }}>
          <li>「指示文をコピー」を押す</li>
          <li>
            Claude（claude.ai のチャット、または Claude Code）に図面 PDF を添付するか、Googleドライブのフォルダを指定して、コピーした指示文を貼って送る
          </li>
          <li>返ってきた JSON をそのまま下の欄に貼り付けて「取り込む」</li>
        </ol>
        <div className="flex" style={{ marginBottom: 8 }}>
          <EzButton icon="copy" label={copied ? "コピーしました" : "指示文をコピー"} onClick={copyPrompt} />
        </div>
        <textarea className="json" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ここに Claude の返答（JSON）を貼り付け" />
        <div className="flex" style={{ marginTop: 8 }}>
          <EzButton icon="check" label="取り込む" dark onClick={applyPaste} disabled={!paste.trim()} />
        </div>
      </Section>
    </>
  );
}
