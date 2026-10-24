"use client";

import { NumInput } from "../NumInput";
import { ADJACENCY_LABEL, ORIENTATIONS } from "@/lib/gaihi/constants";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Adjacency, Orientation, Perimeter, Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";

export function PerimetersEditor({ project, update }: { project: Project; update: (fn: (p: Project) => void) => void }) {
  const edit = (id: string, fn: (x: Perimeter) => void) =>
    update((p) => {
      const x = p.perimeters.find((y) => y.id === id);
      if (x) fn(x);
    });
  const total = project.perimeters.reduce((a, x) => a + x.length, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>土間床等の外周部</h2>
        <div className="spacer" />
        <button
          className="btn small"
          onClick={() =>
            update((p) =>
              void p.perimeters.push({
                id: newId("pm"),
                name: "土間外周",
                specId: pickSpec(p.specs, "perimeter")?.id ?? "",
                orientation: "S",
                length: 0,
                adjacency: "outside",
                basis: "",
              }),
            )
          }
        >
          ＋ 外周部
        </button>
      </div>
      <p className="muted small">玄関・土間収納・基礎断熱の浴室などの外周長さを、方位ごと・外気側／床下側に分けて入れます。</p>
      <div className="table-wrap">
        <table className="data editable">
          <thead>
            <tr>
              <th>名称</th>
              <th>仕様（ψ）</th>
              <th>方位</th>
              <th>隣接空間</th>
              <th className="num">長さ [m]</th>
              <th>根拠</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {project.perimeters.map((x) => (
              <tr key={x.id}>
                <td>
                  <input value={x.name} onChange={(e) => edit(x.id, (y) => void (y.name = e.target.value))} />
                </td>
                <td>
                  <select value={x.specId} onChange={(e) => edit(x.id, (y) => void (y.specId = e.target.value))}>
                    <option value="">（未選択）</option>
                    {project.specs
                      .filter((s) => s.kind === "perimeter")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（ψ{s.psi}）
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select value={x.orientation} onChange={(e) => edit(x.id, (y) => void (y.orientation = e.target.value as Orientation))}>
                    {ORIENTATIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={x.adjacency} onChange={(e) => edit(x.id, (y) => void (y.adjacency = e.target.value as Adjacency))}>
                    {(["outside", "underfloor", "unheated"] as Adjacency[]).map((a) => (
                      <option key={a} value={a}>
                        {ADJACENCY_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <NumInput value={x.length} onChange={(v) => edit(x.id, (y) => void (y.length = v))} />
                </td>
                <td className="wide">
                  <input value={x.basis} onChange={(e) => edit(x.id, (y) => void (y.basis = e.target.value))} />
                </td>
                <td>
                  <button className="btn small danger" onClick={() => update((p) => void (p.perimeters = p.perimeters.filter((y) => y.id !== x.id)))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>外周長さの合計</td>
              <td className="num">{fmt(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
