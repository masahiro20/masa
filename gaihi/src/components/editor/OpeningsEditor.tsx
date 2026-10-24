"use client";

import { NumInput } from "../NumInput";
import { openingArea } from "@/lib/gaihi/calc";
import { ORIENTATION_LABEL, WALL_ORIENTATIONS } from "@/lib/gaihi/constants";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Opening, Orientation, Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";

export function OpeningsEditor({ project, update }: { project: Project; update: (fn: (p: Project) => void) => void }) {
  const edit = (id: string, fn: (o: Opening) => void) =>
    update((p) => {
      const o = p.openings.find((x) => x.id === id);
      if (o) fn(o);
    });
  const walls = project.surfaces.filter((s) => s.kind === "wall");
  const total = project.openings.reduce((a, o) => a + openingArea(o), 0);
  const add = (kind: Opening["kind"]) =>
    update((p) => {
      const wall = p.surfaces.find((s) => s.kind === "wall");
      p.openings.push({
        id: newId("op"),
        name: kind === "door" ? "ドア" : "窓",
        kind,
        specId: pickSpec(p.specs, kind)?.id ?? "",
        orientation: wall?.orientation ?? "S",
        width: 0,
        height: 0,
        count: 1,
        surfaceId: wall?.id ?? null,
        basis: "",
      });
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>開口部（窓・ドア）</h2>
        <div className="spacer" />
        <button className="btn small" onClick={() => add("window")}>
          ＋ 窓
        </button>
        <button className="btn small" onClick={() => add("door")}>
          ＋ ドア
        </button>
      </div>
      <div className="table-wrap">
        <table className="data editable">
          <thead>
            <tr>
              <th>名称・記号</th>
              <th>種類</th>
              <th>仕様</th>
              <th>取り付く外壁</th>
              <th className="num">幅 [m]</th>
              <th className="num">高さ [m]</th>
              <th className="num">個数</th>
              <th className="num">面積 [㎡]</th>
              <th>根拠</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {project.openings.map((o) => (
              <tr key={o.id}>
                <td>
                  <input value={o.name} onChange={(e) => edit(o.id, (x) => void (x.name = e.target.value))} />
                </td>
                <td>
                  <select
                    value={o.kind}
                    onChange={(e) =>
                      edit(o.id, (x) => {
                        x.kind = e.target.value as Opening["kind"];
                        x.specId = pickSpec(project.specs, x.kind)?.id ?? "";
                      })
                    }
                  >
                    <option value="window">窓</option>
                    <option value="door">ドア</option>
                  </select>
                </td>
                <td>
                  <select value={o.specId} onChange={(e) => edit(o.id, (x) => void (x.specId = e.target.value))}>
                    <option value="">（未選択）</option>
                    {project.specs
                      .filter((s) => s.kind === o.kind)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select
                    value={o.surfaceId ?? `dir:${o.orientation}`}
                    onChange={(e) =>
                      edit(o.id, (x) => {
                        const v = e.target.value;
                        if (v.startsWith("dir:")) {
                          x.surfaceId = null;
                          x.orientation = v.slice(4) as Orientation;
                        } else {
                          x.surfaceId = v;
                          x.orientation = walls.find((w) => w.id === v)?.orientation ?? x.orientation;
                        }
                      })
                    }
                  >
                    {walls.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}（{ORIENTATION_LABEL[w.orientation]}）
                      </option>
                    ))}
                    {WALL_ORIENTATIONS.map((d) => (
                      <option key={d} value={`dir:${d}`}>
                        {ORIENTATION_LABEL[d]}の外壁（自動）
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <NumInput value={o.width} onChange={(v) => edit(o.id, (x) => void (x.width = v))} />
                </td>
                <td className="num">
                  <NumInput value={o.height} onChange={(v) => edit(o.id, (x) => void (x.height = v))} />
                </td>
                <td className="num">
                  <NumInput step="1" value={o.count} onChange={(v) => edit(o.id, (x) => void (x.count = Math.max(1, Math.round(v))))} />
                </td>
                <td className="num">{fmt(openingArea(o))}</td>
                <td className="wide">
                  <input value={o.basis} onChange={(e) => edit(o.id, (x) => void (x.basis = e.target.value))} />
                </td>
                <td>
                  <button className="btn small danger" onClick={() => update((p) => void (p.openings = p.openings.filter((x) => x.id !== o.id)))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>開口部面積の合計</td>
              <td className="num">{fmt(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
