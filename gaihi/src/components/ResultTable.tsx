import { ORIENTATION_LABEL, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import type { CalcResult } from "@/lib/gaihi/calc";
import { fmt } from "@/lib/format";

/** 部位ごとの計算明細（熱損失量と日射熱取得量） */
export function ResultTable({ result, className = "data" }: { result: CalcResult; className?: string }) {
  const heating = result.mH !== null;
  return (
    <table className={className}>
      <thead>
        <tr>
          <th>部位</th>
          <th>名称</th>
          <th>方位</th>
          <th className="num">A[㎡]/L[m]</th>
          <th className="num">U/ψ</th>
          <th className="num">H</th>
          <th className="num">A・U・H</th>
          <th className="num">η冷</th>
          <th className="num">ν冷</th>
          <th className="num">m冷</th>
          {heating && (
            <>
              <th className="num">η暖</th>
              <th className="num">ν暖</th>
              <th className="num">m暖</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((r) => (
          <tr key={`${r.group}-${r.id}`}>
            <td>{SPEC_KIND_LABEL[r.kind]}</td>
            <td>
              {r.name}
              <div className="basis">{r.specName}</div>
            </td>
            <td>{ORIENTATION_LABEL[r.orientation]}</td>
            <td className="num">{fmt(r.amount)}</td>
            <td className="num">{fmt(r.value, 3)}</td>
            <td className="num">{fmt(r.h, 2)}</td>
            <td className="num">{fmt(r.q, 3)}</td>
            <td className="num">{fmt(r.etaC, 3)}</td>
            <td className="num">{fmt(r.nuC, 3)}</td>
            <td className="num">{fmt(r.mC, 3)}</td>
            {heating && (
              <>
                <td className="num">{fmt(r.etaH, 3)}</td>
                <td className="num">{fmt(r.nuH, 3)}</td>
                <td className="num">{fmt(r.mH, 3)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>合計（ΣA = 外皮面積の合計）</td>
          <td className="num">{fmt(result.totalArea)}</td>
          <td colSpan={2} />
          <td className="num">{fmt(result.q, 3)}</td>
          <td colSpan={2} />
          <td className="num">{fmt(result.mC, 3)}</td>
          {heating && (
            <>
              <td colSpan={2} />
              <td className="num">{fmt(result.mH, 3)}</td>
            </>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

export function Formula({ result }: { result: CalcResult }) {
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      <li>
        UA = q ÷ ΣA = {fmt(result.q, 3)} ÷ {fmt(result.totalArea)} = {fmt(result.uaRaw, 4)} → <b>{fmt(result.ua)}</b>（小数第3位以下切り上げ）
      </li>
      <li>
        ηAC = mC ÷ ΣA × 100 = {fmt(result.mC, 3)} ÷ {fmt(result.totalArea)} × 100 = {fmt(result.etaACRaw, 3)} → <b>{fmt(result.etaAC, 1)}</b>
        （小数第2位以下切り上げ）
      </li>
      {result.etaAHRaw !== null && (
        <li>
          ηAH = mH ÷ ΣA × 100 = {fmt(result.mH, 3)} ÷ {fmt(result.totalArea)} × 100 = {fmt(result.etaAHRaw, 3)} → <b>{fmt(result.etaAH, 1)}</b>
          （小数第2位以下切り捨て）
        </li>
      )}
    </ul>
  );
}
