"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { MascotFace } from "@/components/ez/Mascot";
import { areaByOrientation, calculate, layersU, specValue, usedSpecs, type CalcResult, type ResultRow } from "@/lib/gaihi/calc";
import { ADJACENCY_LABEL, LAYER_CATEGORY_LABEL, ORIENTATION_LABEL, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import type { Project, SpecKind } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { getProject } from "@/lib/store";

// 外皮性能計算書。A4 縦のページに分けて組み、表紙に目次とページ番号を載せる。
// 長い表は ROWS_PER_PAGE 行ごとに次のページへ送るので、目次のページ番号は印刷結果と一致する。

const ROWS_PER_PAGE = 24;

interface Sheet {
  /** 目次に載せる見出し（そのページから始まる節）。続きのページは undefined */
  toc?: { label: string; level: 1 | 2 };
  heading?: ReactNode;
  body: ReactNode;
}

function chunk<T>(rows: T[], n = ROWS_PER_PAGE): T[][] {
  if (rows.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

const n2 = (x: number | null | undefined) => fmt(x ?? null, 2);
const n3 = (x: number | null | undefined) => fmt(x ?? null, 3);
const okText = (v: boolean | null) => (v === null ? "―" : v ? "適合" : "不適合");

function dateLabel(iso: string) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  const t = new Date();
  return y ? `${y}年${m}月${d}日` : `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}

/** 部位（面積×U×H）の明細表。長ければページを分ける */
function lossSheets(
  title: string,
  rows: ResultRow[],
  extra: (r: ResultRow) => ReactNode[],
  extraHeads: string[],
  unit: "㎡" | "m" = "㎡",
): Sheet[] {
  const total = rows.reduce((a, r) => a + r.q, 0);
  const amount = rows.reduce((a, r) => a + r.amount, 0);
  return chunk(rows).map((part, i, all) => ({
    toc: i === 0 ? { label: title, level: 2 } : undefined,
    heading: i === 0 ? title : `${title}（続き）`,
    body: (
      <table className="rt">
        <thead>
          <tr>
            <th>No.</th>
            <th>名称</th>
            <th>方位</th>
            {extraHeads.map((h) => (
              <th key={h}>{h}</th>
            ))}
            <th>{unit === "m" ? "長さ L[m]" : "面積 A[㎡]"}</th>
            <th>{unit === "m" ? "ψ[W/mK]" : "U[W/㎡K]"}</th>
            <th>温度差係数 H</th>
            <th>熱損失量[W/K]</th>
          </tr>
        </thead>
        <tbody>
          {part.length === 0 && (
            <tr>
              <td colSpan={7 + extraHeads.length} className="c">
                該当なし
              </td>
            </tr>
          )}
          {part.map((r, k) => (
            <tr key={`${r.group}-${r.id}`}>
              <td className="c">{i * ROWS_PER_PAGE + k + 1}</td>
              <td>
                {r.name}
                <div className="sub">{r.specName}</div>
              </td>
              <td className="c">{ORIENTATION_LABEL[r.orientation]}</td>
              {extra(r).map((x, j) => (
                <td key={j} className="n">
                  {x}
                </td>
              ))}
              <td className="n">{n2(r.amount)}</td>
              <td className="n">{n3(r.value)}</td>
              <td className="n">{r.h.toFixed(2)}</td>
              <td className="n">{n3(r.q)}</td>
            </tr>
          ))}
        </tbody>
        {i === all.length - 1 && part.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3 + extraHeads.length}>合計</td>
              <td className="n">{n2(amount)}</td>
              <td colSpan={2} />
              <td className="n">{n3(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    ),
  }));
}

function gainSheets(title: string, rows: ResultRow[], season: "cooling" | "heating"): Sheet[] {
  const cool = season === "cooling";
  const total = rows.reduce((a, r) => a + ((cool ? r.mC : r.mH) ?? 0), 0);
  return chunk(rows).map((part, i, all) => ({
    toc: i === 0 ? { label: title, level: 2 } : undefined,
    heading: i === 0 ? title : `${title}（続き）`,
    body: (
      <table className="rt">
        <thead>
          <tr>
            <th>No.</th>
            <th>部位</th>
            <th>名称</th>
            <th>方位</th>
            <th>A[㎡]/L[m]</th>
            <th>日射熱取得率 η</th>
            <th>方位係数 ν</th>
            <th>日射熱取得量 m</th>
          </tr>
        </thead>
        <tbody>
          {part.map((r, k) => (
            <tr key={`${r.group}-${r.id}`}>
              <td className="c">{i * ROWS_PER_PAGE + k + 1}</td>
              <td className="c">{SPEC_KIND_LABEL[r.kind]}</td>
              <td>{r.name}</td>
              <td className="c">{ORIENTATION_LABEL[r.orientation]}</td>
              <td className="n">{n2(r.amount)}</td>
              <td className="n">{n3(cool ? r.etaC : r.etaH)}</td>
              <td className="n">{n3(cool ? r.nuC : r.nuH)}</td>
              <td className="n">{n3(cool ? r.mC : r.mH)}</td>
            </tr>
          ))}
        </tbody>
        {i === all.length - 1 && (
          <tfoot>
            <tr>
              <td colSpan={7}>合計 m{cool ? "C" : "H"}</td>
              <td className="n">{n3(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    ),
  }));
}

function buildSheets(project: Project, r: CalcResult, forApplication: boolean): Sheet[] {
  const byKind = (...kinds: SpecKind[]) => r.rows.filter((x) => kinds.includes(x.kind));
  const surfaceById = new Map(project.surfaces.map((s) => [s.id, s]));
  const openingById = new Map(project.openings.map((o) => [o.id, o]));
  const sheets: Sheet[] = [];

  // 1. 計算結果
  const kijun = r.judgments.find((j) => j.grade === "kijun")!;
  sheets.push({
    toc: { label: "1. 計算結果", level: 1 },
    heading: "1. 計算結果",
    body: (
      <>
        <table className="rt big">
          <tbody>
            <tr>
              <th>外皮平均熱貫流率（UA）</th>
              <td className="n">{n2(r.ua)}</td>
              <td>W/(㎡・K)</td>
            </tr>
            <tr>
              <th>冷房期の平均日射熱取得率（ηAC）</th>
              <td className="n">{fmt(r.etaAC, 1)}</td>
              <td />
            </tr>
            <tr>
              <th>暖房期の平均日射熱取得率（ηAH）</th>
              <td className="n">{fmt(r.etaAH, 1)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <p className="judge">
          省エネ基準（{project.region}地域）：<b>{okText(kijun.ok)}</b>
        </p>
        <h3>基準値との比較</h3>
        <table className="rt">
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
                <td className="n">{j.uaStandard ?? "―"}</td>
                <td className="c">{okText(j.uaOk)}</td>
                <td className="n">{j.etaACStandard ?? "―"}</td>
                <td className="c">{okText(j.etaACOk)}</td>
                <td className="c">
                  <b>{okText(j.ok)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>計算式</h3>
        <table className="rt">
          <tbody>
            <tr>
              <th>外皮面積の合計 ΣA</th>
              <td className="n">{n2(r.totalArea)} ㎡</td>
            </tr>
            <tr>
              <th>総熱損失量 q</th>
              <td className="n">{n3(r.q)} W/K</td>
            </tr>
            <tr>
              <th>UA = q ÷ ΣA</th>
              <td className="n">
                {n3(r.q)} ÷ {n2(r.totalArea)} = {fmt(r.uaRaw, 4)} → {n2(r.ua)}（小数第3位以下切り上げ）
              </td>
            </tr>
            <tr>
              <th>ηAC = mC ÷ ΣA × 100</th>
              <td className="n">
                {n3(r.mC)} ÷ {n2(r.totalArea)} × 100 = {fmt(r.etaACRaw, 3)} → {fmt(r.etaAC, 1)}（小数第2位以下切り上げ）
              </td>
            </tr>
            {r.etaAHRaw !== null && (
              <tr>
                <th>ηAH = mH ÷ ΣA × 100</th>
                <td className="n">
                  {n3(r.mH)} ÷ {n2(r.totalArea)} × 100 = {fmt(r.etaAHRaw, 3)} → {fmt(r.etaAH, 1)}（小数第2位以下切り捨て）
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!forApplication && r.qValue !== null && (
          <p className="note">
            参考：熱損失係数 Q値 {n2(r.qValue)} W/(㎡・K)（換気回数 {project.ventilation.rate} 回/h・熱交換効率 {project.ventilation.heatRecovery}・C値{" "}
            {project.ventilation.cValue}）／夏期日射取得係数 μ値 {n3(r.mu)}
          </p>
        )}
      </>
    ),
  });

  // 2. 熱損失の計算（部位別の集計 → 部位ごとの明細）
  const groups: { label: string; rows: ResultRow[] }[] = [
    { label: "ドア、窓", rows: r.rows.filter((x) => x.group === "opening") },
    { label: "外壁", rows: byKind("wall") },
    { label: "屋根・天井", rows: byKind("roof", "ceiling") },
    { label: "床", rows: byKind("floor") },
    { label: "基礎壁", rows: byKind("baseWall") },
    { label: "基礎、玄関土間（外周部）", rows: [...byKind("doma"), ...r.rows.filter((x) => x.group === "perimeter")] },
  ];
  sheets.push({
    toc: { label: "2. 熱損失の計算", level: 1 },
    heading: "2. 熱損失の計算",
    body: (
      <>
        <table className="rt">
          <thead>
            <tr>
              <th>部位</th>
              <th>面積[㎡]・長さ[m]</th>
              <th>熱損失量[W/K]</th>
              <th>割合</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const q = g.rows.reduce((a, x) => a + x.q, 0);
              const area = g.rows.filter((x) => x.group !== "perimeter").reduce((a, x) => a + x.amount, 0);
              const len = g.rows.filter((x) => x.group === "perimeter").reduce((a, x) => a + x.amount, 0);
              return (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td className="n">
                    {n2(area)} ㎡{len > 0 ? `／${n2(len)} m` : ""}
                  </td>
                  <td className="n">{n3(q)}</td>
                  <td className="n">{r.q > 0 ? `${((q / r.q) * 100).toFixed(1)}%` : "―"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>合計</td>
              <td className="n">ΣA {n2(r.totalArea)} ㎡</td>
              <td className="n">{n3(r.q)}</td>
              <td className="n">100%</td>
            </tr>
          </tfoot>
        </table>
        <h3>方位別の外壁・開口部面積</h3>
        <table className="rt">
          <thead>
            <tr>
              <th>方位</th>
              <th>外壁（開口部含む）[㎡]</th>
              <th>開口部[㎡]</th>
              <th>外壁（正味）[㎡]</th>
            </tr>
          </thead>
          <tbody>
            {[...areaByOrientation(project)].map(([o, v]) => (
              <tr key={o}>
                <td className="c">{ORIENTATION_LABEL[o]}</td>
                <td className="n">{n2(v.wallGross)}</td>
                <td className="n">{n2(v.opening)}</td>
                <td className="n">{n2(v.wallNet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">H：温度差係数（外気 1.0／床下・外気に通じていない空間 0.7）。熱損失量 = 面積 × 熱貫流率 × H（外周部は 長さ × ψ × H）</p>
      </>
    ),
  });
  sheets.push(
    ...lossSheets(
      "1) ドア、窓の計算結果",
      groups[0].rows,
      (x) => {
        const o = openingById.get(x.id);
        return o ? [`${fmt(o.width, 3)}×${fmt(o.height, 3)}`, String(o.count)] : ["", ""];
      },
      ["幅×高さ[m]", "数"],
    ),
    ...lossSheets(
      "2) 外壁の計算結果",
      groups[1].rows,
      (x) => {
        const s = surfaceById.get(x.id);
        const gross = s?.area ?? 0;
        return [n2(gross), n2(gross - x.amount)];
      },
      ["外壁（開口部含む）", "開口部"],
    ),
    ...lossSheets("3) 屋根・天井の計算結果", groups[2].rows, () => [], []),
    ...lossSheets("4) 床の計算結果", groups[3].rows, (x) => [ADJACENCY_LABEL[surfaceById.get(x.id)?.adjacency ?? "outside"]], ["隣接空間"]),
    ...lossSheets("5) 基礎壁の計算結果", groups[4].rows, () => [], []),
    ...lossSheets(
      "6) 基礎、玄関土間の計算結果",
      r.rows.filter((x) => x.group === "perimeter"),
      (x) => [ADJACENCY_LABEL[project.perimeters.find((p) => p.id === x.id)?.adjacency ?? "outside"]],
      ["隣接空間"],
      "m",
    ).map((sh, i) =>
      i === 0
        ? {
            ...sh,
            body: (
              <>
                {sh.body}
                <h3>土間床の面積（外皮面積に算入）</h3>
                <table className="rt">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>面積[㎡]</th>
                      <th>根拠</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.surfaces
                      .filter((s) => s.kind === "doma")
                      .map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td className="n">{n2(s.area)}</td>
                          <td className="sub">{s.basis}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ),
          }
        : sh,
    ),
  );

  // 3. 日射熱取得量の計算
  const gainRows = r.rows.filter((x) => x.nuC > 0 || (x.nuH ?? 0) > 0);
  sheets.push(
    { toc: { label: "3. 日射熱取得量の計算", level: 1 }, heading: "3. 日射熱取得量の計算", body: <GainSummary r={r} /> },
    ...gainSheets("1) 冷房期の計算結果", gainRows, "cooling"),
    ...(r.mH !== null ? gainSheets("2) 暖房期の計算結果", gainRows, "heating") : []),
  );

  // 4. 部位の仕様（熱貫流率の計算）
  const specs = usedSpecs(project);
  chunk(specs, 6).forEach((part, i) =>
    sheets.push({
      toc: i === 0 ? { label: "4. 部位の仕様（熱貫流率の計算）", level: 1 } : undefined,
      heading: i === 0 ? "4. 部位の仕様（熱貫流率の計算）" : "4. 部位の仕様（続き）",
      body: (
        <>
          {part.map((s) => {
            const lu = s.method === "layers" && s.layers.length > 0 ? layersU(s) : null;
            return (
              <div key={s.id} className="spec">
                <div className="spec-head">
                  【{SPEC_KIND_LABEL[s.kind]}】{s.name}
                  <span>
                    {s.kind === "perimeter" ? `ψ = ${n3(s.psi)} W/(m・K)` : s.kind === "doma" ? "（外周部 ψ で計上）" : `U = ${n3(specValue(s))} W/(㎡・K)`}
                    {s.kind === "window" ? `　ηd = ${n3(s.etaD)}` : ""}
                  </span>
                </div>
                {lu && (
                  <table className="rt">
                    <thead>
                      <tr>
                        <th>カテゴリ</th>
                        <th>材料名</th>
                        <th>厚み[mm]</th>
                        <th>λ[W/mK]</th>
                        <th>R[㎡K/W]</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={4}>室内側表面熱伝達抵抗 Ri</td>
                        <td className="n">{n3(s.ri)}</td>
                      </tr>
                      {s.layers.map((l) => (
                        <tr key={l.id}>
                          <td>{LAYER_CATEGORY_LABEL[l.category]}</td>
                          <td>{l.name}</td>
                          <td className="n">{l.thickness}</td>
                          <td className="n">{n3(l.lambda)}</td>
                          <td className="n">{l.lambda > 0 ? n3(l.thickness / 1000 / l.lambda) : "―"}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={4}>外気側表面熱伝達抵抗 Ro</td>
                        <td className="n">{n3(s.ro)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {lu && (
                  <div className="sub">
                    {lu.hasBridge
                      ? `一般部 R=${n3(lu.rGeneral)}・熱橋部 R=${n3(lu.rBridge)}、一般部の面積比率 ${s.ratio} → U = ${s.ratio}÷${n3(lu.rGeneral)} + ${fmt(1 - s.ratio, 2)}÷${n3(lu.rBridge)} = ${n3(lu.u)}`
                      : `R=${n3(lu.rGeneral)} → U = 1÷${n3(lu.rGeneral)} = ${n3(lu.u)}`}
                  </div>
                )}
                {s.note && <div className="sub">{s.note}</div>}
              </div>
            );
          })}
        </>
      ),
    }),
  );

  // 5. 外皮面積の拾い（根拠）
  const allSurfaces = project.surfaces;
  chunk(allSurfaces).forEach((part, i) =>
    sheets.push({
      toc: i === 0 ? { label: "5. 外皮面積の拾い（根拠）", level: 1 } : undefined,
      heading: i === 0 ? "5. 外皮面積の拾い（根拠）" : "5. 外皮面積の拾い（続き）",
      body: (
        <table className="rt">
          <thead>
            <tr>
              <th>部位</th>
              <th>名称</th>
              <th>方位</th>
              <th>面積[㎡]</th>
              <th>根拠</th>
            </tr>
          </thead>
          <tbody>
            {part.map((s) => (
              <tr key={s.id}>
                <td className="c">{SPEC_KIND_LABEL[s.kind]}</td>
                <td>{s.name}</td>
                <td className="c">{ORIENTATION_LABEL[s.orientation]}</td>
                <td className="n">{n2(s.area)}</td>
                <td className="sub">{s.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    }),
  );

  // 6. 参考（申請用には載せない）
  if (!forApplication && project.notes.length > 0) {
    sheets.push({
      toc: { label: "6. 図面読み取りメモ（参考）", level: 1 },
      heading: "6. 図面読み取りメモ（参考）",
      body: (
        <ul className="memo">
          {project.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ),
    });
  }
  return sheets;
}

function GainSummary({ r }: { r: CalcResult }) {
  const dirs = new Map<string, { c: number; h: number }>();
  for (const x of r.rows) {
    const k = ORIENTATION_LABEL[x.orientation];
    const v = dirs.get(k) ?? { c: 0, h: 0 };
    v.c += x.mC;
    v.h += x.mH ?? 0;
    dirs.set(k, v);
  }
  return (
    <>
      <table className="rt">
        <thead>
          <tr>
            <th>方位</th>
            <th>冷房期 mC</th>
            <th>暖房期 mH</th>
          </tr>
        </thead>
        <tbody>
          {[...dirs].map(([k, v]) => (
            <tr key={k}>
              <td className="c">{k}</td>
              <td className="n">{n3(v.c)}</td>
              <td className="n">{r.mH === null ? "―" : n3(v.h)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>合計</td>
            <td className="n">{n3(r.mC)}</td>
            <td className="n">{r.mH === null ? "―" : n3(r.mH)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="note">
        η：日射熱取得率（不透明部位は 0.034×U、窓は ηd×取得日射熱補正係数）。ν：方位係数（外気に接しない部位・下面は 0）。日射熱取得量 m = A × η × ν
      </p>
    </>
  );
}

function Report() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  // 申請用印刷：社内メモ・参考値（Q値・μ値）を載せない
  const forApplication = params.get("mode") === "app";
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  useEffect(() => setProject(getProject(id) ?? null), [id]);
  useEffect(() => {
    if (project) document.title = `外皮性能計算書_${project.name}${forApplication ? "_申請用" : ""}`;
  }, [project, forApplication]);

  if (project === undefined) return null;
  if (project === null) return <div className="sheet">物件が見つかりません。</div>;

  const r = calculate(project);
  const sheets = buildSheets(project, r, forApplication);
  // 表紙が1ページ目、本文は2ページ目から
  const toc = sheets.flatMap((s, i) => (s.toc ? [{ ...s.toc, page: i + 2 }] : []));
  const total = sheets.length + 1;

  return (
    <div className="report-wrap">
      <div className="no-print report-bar">
        <button className="ez-btn" onClick={() => window.print()}>
          <span className="label">{forApplication ? "申請用 印刷 / PDF に保存" : "印刷 / PDF に保存"}</span>
        </button>
        <span className="small">全 {total} ページ（A4 縦）</span>
      </div>

      {/* 表紙 */}
      <section className="sheet cover">
        <div className="cover-top">
          <span className="std">平成28年 省エネ基準</span>
          <span className="brand">
            <MascotFace size={44} />
            <span>外皮計算ツール</span>
          </span>
        </div>
        <h1>外皮性能計算書</h1>
        <div className="cover-sub">【木造戸建住宅版】</div>
        <div className="cover-rule">
          <span />
          <span />
        </div>
        <div className="cover-basic">
          <div className="cap">基本事項</div>
          <table>
            <tbody>
              {[
                ["計算日", dateLabel(project.date)],
                ["住宅名称", project.name],
                ["建設地", project.address],
                ["地域区分", String(project.region)],
                ["構法", project.framing === "jikugumi" ? "軸組" : "枠組"],
                ["作成者", project.author],
              ].map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ol className="cover-toc">
          {toc.map((t, i) => (
            <li key={i} className={t.level === 2 ? "lv2" : ""}>
              <span>{t.label}</span>
              <span>{t.page} P</span>
            </li>
          ))}
        </ol>
        <div className="pno">1</div>
      </section>

      {sheets.map((s, i) => (
        <section className="sheet" key={i}>
          <div className="sheet-head">
            <span>外皮性能計算書　{project.name}</span>
            <span>{forApplication ? "申請用" : ""}</span>
          </div>
          {s.heading && <h2>{s.heading}</h2>}
          {s.body}
          <div className="pno">{i + 2}</div>
        </section>
      ))}
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}
