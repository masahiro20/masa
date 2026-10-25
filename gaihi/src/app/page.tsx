"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/ez/Mascot";
import { AppFrame, EzButton, Modal } from "@/components/ez/ui";
import { calculate } from "@/lib/gaihi/calc";
import { newId, newProject, normalizeProject, sampleProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";
import { fmt, fmtDate } from "@/lib/format";
import { createShareLink } from "@/lib/share";
import { deleteProject, listProjects, saveProject } from "@/lib/store";

/** 共有リンクのダイアログ。リンクは相手のブラウザに「複製」を作るだけで、元の物件とはつながらない */
function ShareModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; short: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  // 開発時の二重実行で2回預けないようにする
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createShareLink(window.location.origin, project).then(setLink);
  }, [project]);
  const url = link?.url ?? "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      (document.getElementById("share-url") as HTMLTextAreaElement | null)?.select();
      document.execCommand("copy");
    }
    setCopied(true);
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <Modal
      title={`共有リンク：${project.name}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          {canShare && (
            <EzButton icon="export" label="アプリで送る" disabled={!url} onClick={() => navigator.share({ title: project.name, url }).catch(() => {})} />
          )}
          <EzButton icon="copy" label={copied ? "コピーしました" : "リンクをコピー"} disabled={!url} onClick={copy} />
        </>
      }
    >
      <p className="small" style={{ marginTop: 0 }}>
        このリンクを開いた人のブラウザに、<b>この物件の複製</b>が取り込まれ、入力内容・計算結果・計算書をそのまま見られます。
      </p>
      <textarea id="share-url" className="share-url" readOnly value={url || "リンクを作っています…"} onFocus={(e) => e.target.select()} rows={link?.short === false ? 4 : 1} />
      <ul className="small muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
        <li>渡すのは今の時点のコピーです。このあと物件を直しても、相手の側には反映されません（相手が直してもこちらは変わりません）。</li>
        {link?.short === false ? (
          <li>いまは短いリンクを作れなかったため、データをまるごと入れた長いリンクにしています（サーバーには保存されません）。</li>
        ) : (
          <li>物件データはこのツールの非公開の保存場所に預け、リンクを開いた人だけが取り出せます。リンクを知っている人なら誰でも取り込めるので、送る相手に注意してください。</li>
        )}
      </ul>
    </Modal>
  );
}

function ProjectList() {
  const router = useRouter();
  const params = useSearchParams();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState<Project | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setProjects(listProjects());
  useEffect(refresh, []);

  const open = (p: Project, step?: string) => {
    if (!saveProject(p)) {
      setError("ブラウザに保存できませんでした（プライベートブラウズ等では保存できません）");
      return;
    }
    router.push(`/project?id=${p.id}${step ? `&step=${step}` : ""}`);
  };

  // メニューからの「新規作成」「図面から一発計算」「サンプル」（開発時の二重実行で2件できないようにする）
  const handled = useRef("");
  useEffect(() => {
    const key = params.toString();
    if (!key || handled.current === key) return;
    handled.current = key;
    const n = params.get("new");
    if (n) open(newProject(), n === "auto" ? "drawing" : "basic");
    else if (params.get("sample")) open(sampleProject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (!p.specs || !p.surfaces) throw new Error();
      open(normalizeProject({ ...p, id: newId("prj") }));
    } catch {
      setError("物件データ（JSON）として読み込めませんでした");
    }
  };

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <AppFrame title="物件一覧" icon="list">
      <main className="ez-list-wrap">
        <div className="hero-card">
          <Mascot mood="ok" size={90} />
          <div style={{ flex: 1, minWidth: 280 }}>
            <h2>設計図書から、外皮計算を一発で。</h2>
            <div className="small muted">
              平面図・立面図・仕様書の PDF を入れると、外壁・窓・床・土間・天井の面積を方位別に拾って自動入力し、UA・ηAC・ηAH と外皮性能計算書をそのまま出力します。
            </div>
          </div>
          <EzButton icon="ai" label="図面から一発計算" onClick={() => open(newProject(), "drawing")} />
        </div>

        <div className="ez-toolbar">
          <EzButton icon="plus" label="新規作成" onClick={() => open(newProject(), "basic")} />
          <EzButton icon="doc" label="サンプル物件" onClick={() => open(sampleProject())} />
          <EzButton icon="upload" label="データ読込（JSON）" onClick={() => fileRef.current?.click()} />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
        </div>

        {error && <div className="notice bad">{error}</div>}

        <table className="ez-list">
          <thead>
            <tr>
              <th className="ctrl">
                <button
                  className={`del-btn${checked.size ? " on" : ""}`}
                  title="チェックした物件を削除"
                  disabled={checked.size === 0}
                  onClick={() => {
                    if (!confirm(`${checked.size} 件の物件を削除しますか？`)) return;
                    checked.forEach((id) => deleteProject(id));
                    setChecked(new Set());
                    refresh();
                  }}
                >
                  削除 <span className="box">{checked.size || ""}</span>
                </button>
              </th>
              <th>物件名</th>
              <th>建設地</th>
              <th className="num">地域</th>
              <th className="num">UA値</th>
              <th className="num">ηAC値</th>
              <th>更新日時</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects?.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 24, textAlign: "center" }}>
                  まだ物件がありません。「新規作成」か「図面から一発計算」で始めてください。
                </td>
              </tr>
            )}
            {projects?.map((p) => {
              const r = calculate(p);
              const has = r.totalArea > 0;
              return (
                <tr key={p.id}>
                  <td className="ctrl">
                    <button className={`del-btn${checked.has(p.id) ? " on" : ""}`} onClick={() => toggle(p.id)} aria-pressed={checked.has(p.id)}>
                      <span />
                      <span className="box">{checked.has(p.id) ? "✓" : ""}</span>
                    </button>
                  </td>
                  <td>
                    <Link href={`/project?id=${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="small">{p.address}</td>
                  <td className="num">{p.region}</td>
                  <td className="num">{has ? fmt(r.ua) : "―"}</td>
                  <td className="num">{has ? fmt(r.etaAC, 1) : "―"}</td>
                  <td className="small">{fmtDate(p.updatedAt)}</td>
                  <td>
                    <button
                      className="ez-btn small ghost"
                      style={{ minWidth: 0 }}
                      onClick={() => open({ ...structuredClone(p), id: newId("prj"), name: `${p.name}_コピー` })}
                    >
                      <span className="label">複製</span>
                    </button>{" "}
                    <button className="ez-btn small ghost" style={{ minWidth: 0 }} onClick={() => setSharing(p)}>
                      <span className="label">共有</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 10 }}>
          物件はこのブラウザに保存されます。同じ物件を「複製」して仕様違いのパターンを作り、比較やプレゼンに使えます。「共有」でできるリンクを送ると、相手にこの物件の複製を渡せます。
        </p>
        {sharing && <ShareModal project={sharing} onClose={() => setSharing(null)} />}
      </main>
    </AppFrame>
  );
}

export default function Home() {
  return (
    <Suspense>
      <ProjectList />
    </Suspense>
  );
}
