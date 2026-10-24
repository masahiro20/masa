"use client";

import type { CalcResult } from "@/lib/gaihi/calc";
import { fmt } from "@/lib/format";

function Chip({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="chip na">基準なし</span>;
  return ok ? <span className="chip ok">適合</span> : <span className="chip ng">不適合</span>;
}

export function Summary({
  result,
  region,
  onReport,
  onExcel,
  onJson,
}: {
  result: CalcResult;
  region: number;
  onReport: () => void;
  onExcel: () => void;
  onJson: () => void;
}) {
  const empty = result.totalArea === 0;
  return (
    <aside className="summary">
      <div className="panel">
        <div className="panel-head">
          <h2>計算結果</h2>
          <span className="muted small">{region}地域</span>
        </div>
        <div className="kpis">
          <div className="kpi big">
            <div className="k">UA</div>
            <div className="v">{empty ? "―" : fmt(result.ua)}</div>
          </div>
          <div className="kpi">
            <div className="k">ηAC</div>
            <div className="v">{empty ? "―" : fmt(result.etaAC, 1)}</div>
          </div>
          <div className="kpi">
            <div className="k">ηAH</div>
            <div className="v">{empty ? "―" : fmt(result.etaAH, 1)}</div>
          </div>
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          ΣA {fmt(result.totalArea)}㎡ ／ q {fmt(result.q, 2)} W/K
        </div>
        {result.judgments.map((j) => (
          <div className="judge" key={j.grade}>
            <span>
              {j.label}
              <div className="small muted">
                UA≦{j.uaStandard ?? "―"}　ηAC≦{j.etaACStandard ?? "―"}
              </div>
            </span>
            {empty ? <span className="chip na">―</span> : <Chip ok={j.ok} />}
          </div>
        ))}
        {result.warnings.length > 0 && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            <ul>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 12, flexDirection: "column", alignItems: "stretch" }}>
          <button className="btn primary" onClick={onReport} disabled={empty}>
            計算書を出力（印刷・PDF）
          </button>
          <button className="btn" onClick={onExcel} disabled={empty}>
            Excel で出力
          </button>
          <button className="btn" onClick={onJson}>
            物件データを保存（JSON）
          </button>
        </div>
      </div>
    </aside>
  );
}
