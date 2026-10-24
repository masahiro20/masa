"use client";

import { ETA_AC_STANDARD, GRADES, REGIONS, REGION_COLOR, UA_STANDARD } from "@/lib/gaihi/constants";
import type { CalcResult } from "@/lib/gaihi/calc";
import type { Project } from "@/lib/gaihi/types";
import { fmt, fmtDate } from "@/lib/format";
import { EzButton } from "./ui";

/** 左側：物件名・操作ボタン・計算結果・適合判定・基準表 */
export function ResultPane({
  project,
  result,
  onSave,
  onPrint,
  onApplicationPrint,
  onRecalc,
  onExport,
  onEdit,
}: {
  project: Project;
  result: CalcResult;
  onSave: () => void;
  onPrint: () => void;
  onApplicationPrint: () => void;
  onRecalc: () => void;
  onExport: () => void;
  onEdit: () => void;
}) {
  const empty = result.totalArea === 0;
  const kijun = result.judgments.find((j) => j.grade === "kijun")!;
  const best = [...result.judgments].reverse().find((j) => j.ok === true);
  const v = (x: number | null, d: number) => (empty || x === null ? "―" : fmt(x, d));

  return (
    <div className="ez-left">
      <div className="ez-meta">
        <span>物件名　：</span>
        <b>{project.name}</b>
        <span>計算日時：</span>
        <b>{fmtDate(project.updatedAt)}</b>
      </div>
      <div className="ez-toolbar">
        <EzButton icon="save" label="保存" onClick={onSave} title="物件データをファイル（JSON）に保存" />
        <EzButton icon="print" label="印刷" onClick={onPrint} disabled={empty} title="外皮性能計算書（明細つき）" />
        <EzButton icon="export" label="申請用印刷" onClick={onApplicationPrint} disabled={empty} title="申請添付用の外皮性能計算書" />
        <EzButton icon="refresh" label="再計算" onClick={onRecalc} />
        <EzButton icon="export" label="エクスポート" onClick={onExport} disabled={empty} title="Excel で出力" />
        <EzButton icon="edit" label="データ再修正" onClick={onEdit} />
      </div>
      <hr className="ez-hr" />

      <div className="ez-result">
        <table className="ez-res">
          <tbody>
            <tr>
              <th>外皮平均熱貫流率（UA値）</th>
              <td>
                {v(result.ua, 2)}
                <span className="unit">W/㎡K</span>
              </td>
            </tr>
            <tr>
              <th>冷房期の平均日射熱取得率（ηAC値）</th>
              <td>{v(result.etaAC, 1)}</td>
            </tr>
            <tr>
              <th>暖房期の平均日射熱取得率（ηAH値）</th>
              <td>{v(result.etaAH, 1)}</td>
            </tr>
            <tr className="gap">
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
        <div>
          {empty ? (
            <div className="ez-bubble na">未入力</div>
          ) : kijun.ok === null ? (
            <div className="ez-bubble na">基準なし</div>
          ) : kijun.ok ? (
            <div className="ez-bubble">適合!</div>
          ) : (
            <div className="ez-bubble ng">不適合</div>
          )}
          <div className="ez-bubble-sub">{empty ? "外皮を入力してください" : best ? `${best.label.replace(/（.*）/, "")}レベル` : "省エネ基準"}</div>
        </div>
      </div>
      <table className="ez-res plain" style={{ marginTop: -1 }}>
        <tbody>
          <tr>
            <th>熱損失係数（Q値）</th>
            <td>
              {v(result.qValue, 2)}
              <span className="unit">W/㎡K</span>
            </td>
          </tr>
          <tr>
            <th>夏期日射取得係数（μ値）</th>
            <td>{v(result.mu, 3)}</td>
          </tr>
        </tbody>
      </table>
      <div className="small muted" style={{ marginTop: 6 }}>
        外皮面積の合計 {fmt(result.totalArea)}㎡ ／ 総熱損失量 q {fmt(result.q, 2)} W/K
        {project.totalFloorArea > 0 ? "" : "　※Q値・μ値は延床面積を入れると表示されます"}
      </div>

      {result.warnings.length > 0 && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ez-box">
        <h3>外皮性能基準</h3>
        <div className="table-wrap">
          <table className="ez-std">
            <thead>
              <tr>
                <th colSpan={2}>地域区分</th>
                {REGIONS.map((r) => (
                  <th key={r} className={r === project.region ? "cur" : ""}>
                    {r}
                    <span className="badge-region" style={{ background: REGION_COLOR[r] }} />
                  </th>
                ))}
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {GRADES.map((g, i) => {
                const j = result.judgments.find((x) => x.grade === g.key)!;
                return (
                  <tr key={g.key}>
                    {i === 0 && (
                      <th rowSpan={GRADES.length} style={{ width: 110 }}>
                        外皮平均熱貫流率
                        <br />
                        UA 基準値
                      </th>
                    )}
                    <th style={{ textAlign: "left" }}>{g.label}</th>
                    {UA_STANDARD[g.key].map((x, k) => (
                      <td key={k} className={k + 1 === project.region ? "cur" : ""}>
                        {x ?? "―"}
                      </td>
                    ))}
                    <td>{empty ? "―" : j.uaOk === null ? "―" : j.uaOk ? "○" : "×"}</td>
                  </tr>
                );
              })}
              {GRADES.filter((g) => g.key === "kijun" || g.key === "g6").map((g, i) => {
                const j = result.judgments.find((x) => x.grade === g.key)!;
                return (
                  <tr key={`eta-${g.key}`}>
                    {i === 0 && (
                      <th rowSpan={2}>
                        ηAC 基準値
                      </th>
                    )}
                    <th style={{ textAlign: "left" }}>{g.key === "kijun" ? "省エネ基準・等級5" : "等級6・7"}</th>
                    {ETA_AC_STANDARD[g.key].map((x, k) => (
                      <td key={k} className={k + 1 === project.region ? "cur" : ""}>
                        {x ?? "―"}
                      </td>
                    ))}
                    <td>{empty ? "―" : j.etaACOk === null ? "―" : j.etaACOk ? "○" : "×"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
