"use client";

import { Formula, ResultTable } from "../../ResultTable";
import { areaByOrientation, type CalcResult } from "@/lib/gaihi/calc";
import { ORIENTATION_LABEL } from "@/lib/gaihi/constants";
import type { Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { Section } from "../ui";

export function StepResult({ project, result }: { project: Project; result: CalcResult }) {
  const byDir = [...areaByOrientation(project)];
  return (
    <>
      <Section title="計算結果">
        <Formula result={result} />
      </Section>
      <Section title="方位別の外壁・開口部面積">
        <table className="ez-table">
          <thead>
            <tr>
              <th>方位</th>
              <th className="num">外壁グロス(㎡)</th>
              <th className="num">開口部(㎡)</th>
              <th className="num">正味外壁(㎡)</th>
            </tr>
          </thead>
          <tbody>
            {byDir.map(([o, v]) => (
              <tr key={o}>
                <td className="center">{ORIENTATION_LABEL[o]}</td>
                <td className="num">{fmt(v.wallGross)}</td>
                <td className="num">{fmt(v.opening)}</td>
                <td className="num">{fmt(v.wallNet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="部位別の計算明細">
        <div className="table-wrap">
          <ResultTable result={result} className="ez-table" />
        </div>
      </Section>
    </>
  );
}
