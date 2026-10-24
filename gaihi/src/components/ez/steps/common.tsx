"use client";

import { NumInput } from "../../NumInput";
import { ADJACENCY_LABEL, ORIENTATIONS, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Adjacency, Orientation, Perimeter, Project, Surface } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { DeleteX, EzButton } from "../ui";

type Update = (fn: (p: Project) => void) => void;

/** 部位（天井・床・土間・基礎壁など）の面積表 */
export function SurfaceTable({
  project,
  update,
  kinds,
  addKind,
  addDefaults,
  adjacencies,
  showOrientation = false,
  addLabel,
}: {
  project: Project;
  update: Update;
  kinds: Surface["kind"][];
  addKind: Surface["kind"];
  addDefaults: Pick<Surface, "orientation" | "adjacency" | "name">;
  adjacencies: Adjacency[];
  showOrientation?: boolean;
  addLabel: string;
}) {
  const rows = project.surfaces.filter((s) => kinds.includes(s.kind));
  const edit = (id: string, fn: (s: Surface) => void) =>
    update((p) => {
      const s = p.surfaces.find((x) => x.id === id);
      if (s) fn(s);
    });
  const total = rows.reduce((a, s) => a + s.area, 0);
  return (
    <>
      <table className="ez-table">
        <thead>
          <tr>
            <th>名称・仕様</th>
            {showOrientation && <th style={{ width: 80 }}>方位</th>}
            <th style={{ width: 120 }}>隣接空間</th>
            <th style={{ width: 86 }}>面積(㎡)</th>
            <th>根拠</th>
            <th style={{ width: 40 }}>削除</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={showOrientation ? 6 : 5} className="center muted">
                未入力
              </td>
            </tr>
          )}
          {rows.map((s) => (
            <tr key={s.id}>
              <td>
                <input value={s.name} onChange={(e) => edit(s.id, (x) => void (x.name = e.target.value))} />
                {s.kind !== "doma" && (
                  <select value={s.specId} onChange={(e) => edit(s.id, (x) => void (x.specId = e.target.value))} style={{ marginTop: 3 }}>
                    <option value="">（仕様なし）</option>
                    {project.specs
                      .filter((sp) => sp.kind === s.kind)
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                  </select>
                )}
                {kinds.length > 1 && <div className="basis">{SPEC_KIND_LABEL[s.kind]}</div>}
              </td>
              {showOrientation && (
                <td>
                  <select value={s.orientation} onChange={(e) => edit(s.id, (x) => void (x.orientation = e.target.value as Orientation))}>
                    {ORIENTATIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
              )}
              <td>
                <select value={s.adjacency} onChange={(e) => edit(s.id, (x) => void (x.adjacency = e.target.value as Adjacency))}>
                  {adjacencies.map((a) => (
                    <option key={a} value={a}>
                      {ADJACENCY_LABEL[a]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <NumInput value={s.area} onChange={(v) => edit(s.id, (x) => void (x.area = v))} className="w-num" />
              </td>
              <td>
                <input value={s.basis} onChange={(e) => edit(s.id, (x) => void (x.basis = e.target.value))} />
              </td>
              <td className="center">
                <DeleteX onClick={() => update((p) => void (p.surfaces = p.surfaces.filter((x) => x.id !== s.id)))} />
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <td colSpan={showOrientation ? 3 : 2}>合計</td>
              <td className="num">{fmt(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
      <div style={{ marginTop: 6 }}>
        <EzButton
          small
          icon="check"
          label={addLabel}
          onClick={() =>
            update(
              (p) =>
                void p.surfaces.push({
                  id: newId("sf"),
                  kind: addKind,
                  specId: pickSpec(p.specs, addKind)?.id ?? "",
                  area: 0,
                  basis: "",
                  ...addDefaults,
                }),
            )
          }
        />
      </div>
    </>
  );
}

/** 土間床等の外周部の表 */
export function PerimeterTable({ project, update }: { project: Project; update: Update }) {
  const edit = (id: string, fn: (x: Perimeter) => void) =>
    update((p) => {
      const x = p.perimeters.find((y) => y.id === id);
      if (x) fn(x);
    });
  return (
    <>
      <table className="ez-table">
        <thead>
          <tr>
            <th>名称・仕様（ψ）</th>
            <th style={{ width: 80 }}>方位</th>
            <th style={{ width: 120 }}>隣接空間</th>
            <th style={{ width: 86 }}>長さ(m)</th>
            <th style={{ width: 40 }}>削除</th>
          </tr>
        </thead>
        <tbody>
          {project.perimeters.length === 0 && (
            <tr>
              <td colSpan={5} className="center muted">
                未入力
              </td>
            </tr>
          )}
          {project.perimeters.map((x) => (
            <tr key={x.id}>
              <td>
                <input value={x.name} onChange={(e) => edit(x.id, (y) => void (y.name = e.target.value))} />
                <select value={x.specId} onChange={(e) => edit(x.id, (y) => void (y.specId = e.target.value))} style={{ marginTop: 3 }}>
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
                <NumInput value={x.length} onChange={(v) => edit(x.id, (y) => void (y.length = v))} className="w-num" />
              </td>
              <td className="center">
                <DeleteX onClick={() => update((p) => void (p.perimeters = p.perimeters.filter((y) => y.id !== x.id)))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6 }}>
        <EzButton
          small
          icon="check"
          label="外周部の追加"
          onClick={() =>
            update(
              (p) =>
                void p.perimeters.push({
                  id: newId("pm"),
                  name: "玄関土間 外周",
                  specId: pickSpec(p.specs, "perimeter")?.id ?? "",
                  orientation: p.rotation === 45 ? "SE" : "S",
                  length: 0,
                  adjacency: "outside",
                  basis: "",
                }),
            )
          }
        />
      </div>
    </>
  );
}
