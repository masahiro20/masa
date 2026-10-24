"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Formula, ResultTable } from "@/components/ResultTable";
import { areaByOrientation, calculate, layersU, openingArea, specValue } from "@/lib/gaihi/calc";
import { ADJACENCY_LABEL, ORIENTATION_LABEL, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import type { Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { getProject } from "@/lib/store";

function Report() {
  const id = useSearchParams().get("id") ?? "";
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => setProject(getProject(id) ?? null), [id]);
  useEffect(() => {
    if (project) document.title = `外皮性能計算書_${project.name}`;
  }, [project]);

  if (project === undefined) return null;
  if (project === null) return <div className="report">物件が見つかりません。</div>;

  const r = calculate(project);
  const byDir = [...areaByOrientation(project)];
  const today = new Date();
  const ok = (v: boolean | null) => (v === null ? "―" : v ? "適合" : "不適合");

  return (
    <>
      <div className="no-print" style={{ textAlign: "center", padding: 12 }}>
        <button className="btn primary" onClick={() => window.print()}>
          印刷 / PDF に保存
        </button>
      </div>
      <article className="report">
        <h1>外皮性能計算書</h1>
        <p style={{ textAlign: "center" }}>（建築物省エネ法 住宅部分の外皮性能の評価方法による標準計算）</p>

        <h2>物件概要</h2>
        <table>
          <tbody>
            <tr>
              <th style={{ width: "18%" }}>物件名</th>
              <td colSpan={3}>{project.name}</td>
            </tr>
            <tr>
              <th>建設地</th>
              <td colSpan={3}>{project.address}</td>
            </tr>
            <tr>
              <th>地域の区分</th>
              <td>{project.region}地域</td>
              <th style={{ width: "18%" }}>構造</th>
              <td>{project.structure}</td>
            </tr>
            <tr>
              <th>断熱構造</th>
              <td>{project.insulationType === "floor" ? "床断熱住戸" : "基礎断熱住戸"}</td>
              <th>延床面積</th>
              <td>{project.totalFloorArea ? `${fmt(project.totalFloorArea)} ㎡` : ""}</td>
            </tr>
            <tr>
              <th>作成日</th>
              <td>{`${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`}</td>
              <th>作成者</th>
              <td>{project.author}</td>
            </tr>
          </tbody>
        </table>

        <h2>計算結果</h2>
        <div className="result-box">
          <div>
            外皮平均熱貫流率 UA
            <b>{fmt(r.ua)}</b>W/(㎡・K)
          </div>
          <div>
            冷房期の平均日射熱取得率 ηAC
            <b>{fmt(r.etaAC, 1)}</b>
          </div>
          <div>
            暖房期の平均日射熱取得率 ηAH
            <b>{fmt(r.etaAH, 1)}</b>
          </div>
        </div>
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>基準</th>
              <th>UA 基準値</th>
              <th>UA 判定</th>
              <th>ηAC 基準値</th>
              <th>ηAC 判定</th>
              <th>総合</th>
            </tr>
          </thead>
          <tbody>
            {r.judgments.map((j) => (
              <tr key={j.grade}>
                <td>{j.label}</td>
                <td className="num">{j.uaStandard ?? "―"}</td>
                <td>{ok(j.uaOk)}</td>
                <td className="num">{j.etaACStandard ?? "―"}</td>
                <td>{ok(j.etaACOk)}</td>
                <td>
                  <b>{ok(j.ok)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Formula result={r} />

        <h2>1. 部位の仕様</h2>
        <table>
          <thead>
            <tr>
              <th>部位</th>
              <th>仕様</th>
              <th>構成・備考</th>
              <th>U / ψ</th>
              <th>ηd</th>
            </tr>
          </thead>
          <tbody>
            {project.specs.map((s) => {
              const lu = s.method === "layers" && s.layers.length > 0 ? layersU(s) : null;
              return (
                <tr key={s.id}>
                  <td>{SPEC_KIND_LABEL[s.kind]}</td>
                  <td>{s.name}</td>
                  <td>
                    {lu && (
                      <>
                        {s.layers.map((l) => `${l.name} ${l.thickness}mm(λ${l.lambda}${l.bridgeLambda ? `／熱橋λ${l.bridgeLambda}` : ""})`).join("＋")}
                        <br />
                        Ri{s.ri}・Ro{s.ro}　一般部R={fmt(lu.rGeneral, 3)}・熱橋部R={fmt(lu.rBridge, 3)}　面積比率 {s.ratio}
                        <br />
                      </>
                    )}
                    {s.note}
                  </td>
                  <td className="num">{s.kind === "doma" ? "―" : fmt(specValue(s), 3)}</td>
                  <td className="num">{s.kind === "window" ? fmt(s.etaD, 3) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>2. 外皮面積</h2>
        <table>
          <thead>
            <tr>
              <th>部位</th>
              <th>名称</th>
              <th>方位</th>
              <th>隣接空間</th>
              <th>面積[㎡]</th>
              <th>根拠</th>
            </tr>
          </thead>
          <tbody>
            {project.surfaces.map((s) => (
              <tr key={s.id}>
                <td>{SPEC_KIND_LABEL[s.kind]}</td>
                <td>{s.name}</td>
                <td>{ORIENTATION_LABEL[s.orientation]}</td>
                <td>{ADJACENCY_LABEL[s.adjacency]}</td>
                <td className="num">{fmt(s.area)}</td>
                <td>{s.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>3. 方位別の外壁・開口部面積</h2>
        <table>
          <thead>
            <tr>
              <th>方位</th>
              <th>外壁グロス[㎡]</th>
              <th>開口部[㎡]</th>
              <th>正味外壁[㎡]</th>
            </tr>
          </thead>
          <tbody>
            {byDir.map(([o, v]) => (
              <tr key={o}>
                <td>{ORIENTATION_LABEL[o]}</td>
                <td className="num">{fmt(v.wallGross)}</td>
                <td className="num">{fmt(v.opening)}</td>
                <td className="num">{fmt(v.wallNet)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>4. 開口部</h2>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>種類</th>
              <th>方位</th>
              <th>幅×高さ[m]</th>
              <th>個数</th>
              <th>面積[㎡]</th>
              <th>根拠</th>
            </tr>
          </thead>
          <tbody>
            {project.openings.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.kind === "door" ? "ドア" : "窓"}</td>
                <td>{ORIENTATION_LABEL[o.orientation]}</td>
                <td className="num">
                  {fmt(o.width, 3)}×{fmt(o.height, 3)}
                </td>
                <td className="num">{o.count}</td>
                <td className="num">{fmt(openingArea(o))}</td>
                <td>{o.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {project.perimeters.length > 0 && (
          <>
            <h2>5. 土間床等の外周部</h2>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>方位</th>
                  <th>隣接空間</th>
                  <th>長さ[m]</th>
                  <th>根拠</th>
                </tr>
              </thead>
              <tbody>
                {project.perimeters.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{ORIENTATION_LABEL[p.orientation]}</td>
                    <td>{ADJACENCY_LABEL[p.adjacency]}</td>
                    <td className="num">{fmt(p.length)}</td>
                    <td>{p.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2>6. 計算明細</h2>
        <ResultTable result={r} className="" />

        {project.notes.length > 0 && (
          <>
            <h2>図面読み取りメモ</h2>
            <ul>
              {project.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <p className="small" style={{ marginTop: 12 }}>
          H：温度差係数　η：日射熱取得率（不透明部位は 0.034×U、窓は ηd×取得日射熱補正係数）　ν：方位係数　m：日射熱取得量
        </p>
      </article>
    </>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}
