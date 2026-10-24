"use client";

import { NumInput } from "../NumInput";
import { openingArea, hostSurface } from "@/lib/gaihi/calc";
import { ADJACENCY_LABEL, ORIENTATIONS, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Adjacency, Orientation, Project, Surface } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";

const KINDS: { kind: Surface["kind"]; orientation: Orientation; adjacency: Adjacency }[] = [
  { kind: "wall", orientation: "S", adjacency: "outside" },
  { kind: "ceiling", orientation: "TOP", adjacency: "outside" },
  { kind: "roof", orientation: "TOP", adjacency: "outside" },
  { kind: "floor", orientation: "BOTTOM", adjacency: "underfloor" },
  { kind: "doma", orientation: "BOTTOM", adjacency: "underfloor" },
  { kind: "baseWall", orientation: "S", adjacency: "outside" },
];

export function SurfacesEditor({ project, update }: { project: Project; update: (fn: (p: Project) => void) => void }) {
  const edit = (id: string, fn: (s: Surface) => void) =>
    update((p) => {
      const s = p.surfaces.find((x) => x.id === id);
      if (s) fn(s);
    });
  const openingSum = (s: Surface) =>
    project.openings.filter((o) => hostSurface(project, o)?.id === s.id).reduce((a, o) => a + openingArea(o), 0);
  const order = KINDS.map((k) => k.kind);
  const rows = [...project.surfaces].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const total = project.surfaces.reduce((a, s) => a + s.area, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>外皮（屋根・天井・外壁・床・土間・基礎壁）</h2>
        <div className="spacer" />
        <select
          value=""
          onChange={(e) => {
            const def = KINDS.find((k) => k.kind === e.target.value);
            if (!def) return;
            update((p) =>
              void p.surfaces.push({
                id: newId("sf"),
                name: SPEC_KIND_LABEL[def.kind],
                kind: def.kind,
                specId: pickSpec(p.specs, def.kind)?.id ?? "",
                orientation: def.orientation,
                area: 0,
                adjacency: def.adjacency,
                basis: "",
              }),
            );
          }}
        >
          <option value="">＋ 部位を追加…</option>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {SPEC_KIND_LABEL[k.kind]}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">外壁の面積は開口部を含むグロス面積を入れてください。開口部の面積は自動で差し引きます。</p>
      <div className="table-wrap">
        <table className="data editable">
          <thead>
            <tr>
              <th>部位</th>
              <th>名称</th>
              <th>仕様</th>
              <th>方位</th>
              <th>隣接空間</th>
              <th className="num">面積 [㎡]</th>
              <th className="num">開口部控除後</th>
              <th>根拠</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{SPEC_KIND_LABEL[s.kind]}</td>
                <td>
                  <input value={s.name} onChange={(e) => edit(s.id, (x) => void (x.name = e.target.value))} />
                </td>
                <td>
                  <select value={s.specId} onChange={(e) => edit(s.id, (x) => void (x.specId = e.target.value))}>
                    <option value="">（未選択）</option>
                    {project.specs
                      .filter((sp) => sp.kind === s.kind || (s.kind === "roof" && sp.kind === "ceiling") || (s.kind === "ceiling" && sp.kind === "roof"))
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select value={s.orientation} onChange={(e) => edit(s.id, (x) => void (x.orientation = e.target.value as Orientation))}>
                    {ORIENTATIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={s.adjacency} onChange={(e) => edit(s.id, (x) => void (x.adjacency = e.target.value as Adjacency))}>
                    {(Object.keys(ADJACENCY_LABEL) as Adjacency[]).map((a) => (
                      <option key={a} value={a}>
                        {ADJACENCY_LABEL[a]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <NumInput value={s.area} onChange={(v) => edit(s.id, (x) => void (x.area = v))} />
                </td>
                <td className="num">{s.kind === "wall" ? fmt(s.area - openingSum(s)) : ""}</td>
                <td className="wide">
                  <input value={s.basis} onChange={(e) => edit(s.id, (x) => void (x.basis = e.target.value))} />
                </td>
                <td>
                  <button className="btn small danger" onClick={() => update((p) => void (p.surfaces = p.surfaces.filter((x) => x.id !== s.id)))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>外皮面積の合計（開口部含む）</td>
              <td className="num">{fmt(total)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
