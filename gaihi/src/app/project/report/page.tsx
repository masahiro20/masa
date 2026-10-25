"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Formula, ResultTable } from "@/components/ResultTable";
import { areaByOrientation, calculate, layersU, openingArea, specValue, usedSpecs } from "@/lib/gaihi/calc";
import { ADJACENCY_LABEL, LAYER_CATEGORY_LABEL, ORIENTATION_LABEL, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import type { Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { getProject } from "@/lib/store";

function Report() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  // 申請用印刷：社内メモ・参考値（Q値・μ値）を載せない
  const forApplication = params.get("mode") === "app";
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
  const dateLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return y ? `${y}年${m}月${d}日` : `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  };
  const ok = (v: boolean | null) => (v === null ? "―" : v ? "適合" : "不適合");

  return (
    <>
      <div className="no-print" style={{ textAlign: "center", padding: 12 }}>
        <button className="ez-btn" onClick={() => window.print()}>
          <span className="label">印刷 / PDF に保存</span>
        </button>
      </div>
      <article className="report">
        <div className="rep-head">
          <span>省エネ基準（平成28年基準）</span>
          <span>{forApplication ? "申請用" : ""}</span>
        </div>
        <h1>外皮性能計算書</h1>
        <div className="rep-sub">【木造戸建住宅版】</div>

        <h2>基本事項</h2>
        <table>
          <tbody>
            <tr>
              <th style={{ width: "18%" }}>計算日</th>
              <td>{dateLabel(project.date)}</td>
              <th style={{ width: "18%" }}>作成者</th>
              <td>{project.author}</td>
            </tr>
            <tr>
              <th>住宅名称</th>
              <td colSpan={3}>{project.name}</td>
            </tr>
            <tr>
              <th>建設地</th>
              <td colSpan={3}>{project.address}</td>
            </tr>
            <tr>
              <th>地域区分</th>
              <td>{project.region}</td>
              <th>構法</th>
              <td>
                {project.structure}（{project.framing === "jikugumi" ? "軸組" : "枠組"}）
              </td>
            </tr>
            <tr>
              <th>断熱構造</th>
              <td>
                {project.insulationType === "floor" ? "床断熱" : "基礎断熱"}・
                {project.topInsulation === "roof" ? "屋根断熱" : project.topInsulation === "ceiling" ? "天井断熱" : "屋根・天井断熱"}
              </td>
              <th>延床面積</th>
              <td>{project.totalFloorArea ? `${fmt(project.totalFloorArea)} ㎡` : ""}</td>
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
        {!forApplication && r.qValue !== null && (
          <p className="small">
            参考：熱損失係数 Q値 {fmt(r.qValue)} W/(㎡・K)（換気回数 {project.ventilation.rate} 回/h・熱交換効率 {project.ventilation.heatRecovery}・C値{" "}
            {project.ventilation.cValue}）／夏期日射取得係数 μ値 {fmt(r.mu, 3)}
          </p>
        )}

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
            {usedSpecs(project).map((s) => {
              const lu = s.method === "layers" && s.layers.length > 0 ? layersU(s) : null;
              return (
                <tr key={s.id}>
                  <td>{SPEC_KIND_LABEL[s.kind]}</td>
                  <td>{s.name}</td>
                  <td>
                    {lu && (
                      <>
                        {s.layers.map((l) => `${LAYER_CATEGORY_LABEL[l.category]}：${l.name} ${l.thickness}mm(λ${l.lambda})`).join("／")}
                        <br />
                        Ri{s.ri}・Ro{s.ro}　一般部R={fmt(lu.rGeneral, 3)}
                        {lu.hasBridge && `・熱橋部R=${fmt(lu.rBridge, 3)}　一般部の面積比率 ${s.ratio}`}
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

        {!forApplication && project.notes.length > 0 && (
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
