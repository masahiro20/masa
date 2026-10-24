"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { calculate } from "@/lib/gaihi/calc";
import { newId, newProject, sampleProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";
import { fmt, fmtDate } from "@/lib/format";
import { deleteProject, listProjects, saveProject } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const refresh = () => setProjects(listProjects());
  useEffect(refresh, []);

  const open = (p: Project, auto = false) => {
    if (!saveProject(p)) {
      setError("ブラウザに保存できませんでした（プライベートブラウズ等では保存できません）");
      return;
    }
    router.push(`/project?id=${p.id}${auto ? "&tab=auto" : ""}`);
  };

  const importJson = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Project;
      if (!p.specs || !p.surfaces) throw new Error();
      open({ ...p, id: newId("prj") });
    } catch {
      setError("物件データ（JSON）として読み込めませんでした");
    }
  };

  return (
    <>
      <TopBar />
      <main className="container">
        <section className="panel hero">
          <div>
            <h1>設計図書から、外皮計算を一発で。</h1>
            <p className="muted">
              平面図・立面図・仕様書の PDF を入れるだけで、外壁・開口部・天井・床・土間の面積を方位別に拾い、UA 値・ηAC 値・ηAH 値と計算書まで出力します。
            </p>
            <ol className="small">
              <li>図面（PDF・画像、Googleドライブからも可）を選ぶ</li>
              <li>AI が寸法を読んで面積・周長を自動入力</li>
              <li>根拠付きの明細を確認して、計算書（印刷/PDF）と Excel を出力</li>
            </ol>
          </div>
          <div className="btn-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <button className="btn primary big" onClick={() => open(newProject(), true)}>
              図面から一発計算をはじめる
            </button>
            <button className="btn" onClick={() => open(newProject())}>
              手入力で新規作成
            </button>
            <button className="btn" onClick={() => open(sampleProject())}>
              サンプル物件を開く
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              保存した物件（JSON）を読み込む
            </button>
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
        </section>

        {error && <div className="notice bad">{error}</div>}

        <section className="panel">
          <div className="panel-head">
            <h2>物件一覧</h2>
            <span className="muted small">このブラウザに保存されています</span>
          </div>
          {projects === null ? null : projects.length === 0 ? (
            <p className="muted">まだ物件がありません。上のボタンから作成してください。</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>物件名</th>
                    <th>建設地</th>
                    <th className="num">地域</th>
                    <th className="num">UA</th>
                    <th className="num">ηAC</th>
                    <th>更新</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const r = calculate(p);
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/project?id=${p.id}`}>{p.name}</Link>
                        </td>
                        <td>{p.address}</td>
                        <td className="num">{p.region}</td>
                        <td className="num">{r.totalArea > 0 ? fmt(r.ua) : "―"}</td>
                        <td className="num">{r.totalArea > 0 ? fmt(r.etaAC, 1) : "―"}</td>
                        <td className="small">{fmtDate(p.updatedAt)}</td>
                        <td>
                          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                            <button className="btn small" onClick={() => open({ ...structuredClone(p), id: newId("prj"), name: `${p.name}（コピー）` })}>
                              複製
                            </button>
                            <button
                              className="btn small danger"
                              onClick={() => {
                                if (confirm(`「${p.name}」を削除しますか？`)) {
                                  deleteProject(p.id);
                                  refresh();
                                }
                              }}
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
