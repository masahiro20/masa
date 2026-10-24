"use client";

import { NumInput } from "../NumInput";
import { layersU, specValue } from "@/lib/gaihi/calc";
import { MATERIALS, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import { blankSpec, newId } from "@/lib/gaihi/defaults";
import type { Project, Spec, SpecKind } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";

const KINDS: SpecKind[] = ["ceiling", "roof", "wall", "floor", "baseWall", "doma", "window", "door", "perimeter"];
const LAYERED: SpecKind[] = ["ceiling", "roof", "wall", "floor", "baseWall"];

export function SpecsEditor({ project, update }: { project: Project; update: (fn: (p: Project) => void) => void }) {
  const edit = (id: string, fn: (s: Spec) => void) =>
    update((p) => {
      const s = p.specs.find((x) => x.id === id);
      if (s) fn(s);
    });
  const used = (id: string) =>
    project.surfaces.some((s) => s.specId === id) ||
    project.openings.some((o) => o.specId === id) ||
    project.perimeters.some((x) => x.specId === id);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>仕様（部位の熱性能）</h2>
        <div className="spacer" />
        <select
          value=""
          onChange={(e) => {
            const kind = e.target.value as SpecKind;
            if (kind) update((p) => void p.specs.push(blankSpec(kind, `${SPEC_KIND_LABEL[kind]}（新規）`)));
          }}
        >
          <option value="">＋ 仕様を追加…</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {SPEC_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        U 値は「直接入力」か「材料構成から計算（面積比率法）」を選べます。一つの部位に複数の仕様がある場合は仕様を追加して部位ごとに選んでください。
      </p>
      {KINDS.flatMap((kind) => project.specs.filter((s) => s.kind === kind)).map((s) => (
        <div key={s.id} className="panel" style={{ padding: 12, marginBottom: 10 }}>
          <div className="btn-row" style={{ marginBottom: 8 }}>
            <span className="chip na">{SPEC_KIND_LABEL[s.kind]}</span>
            <input style={{ flex: 1, minWidth: 200 }} value={s.name} onChange={(e) => edit(s.id, (x) => void (x.name = e.target.value))} />
            {LAYERED.includes(s.kind) && (
              <select value={s.method} onChange={(e) => edit(s.id, (x) => void (x.method = e.target.value as Spec["method"]))}>
                <option value="direct">U 値を直接入力</option>
                <option value="layers">材料構成から計算</option>
              </select>
            )}
            <strong style={{ minWidth: 120, textAlign: "right" }}>
              {s.kind === "perimeter" ? `ψ = ${fmt(s.psi, 3)}` : s.kind === "doma" ? "（ψで計上）" : `U = ${fmt(specValue(s), 3)}`}
            </strong>
            <button
              className="btn small danger"
              onClick={() => {
                if (used(s.id) && !confirm("この仕様は使われています。削除すると該当部位は「仕様なし」になります。削除しますか？")) return;
                update((p) => void (p.specs = p.specs.filter((x) => x.id !== s.id)));
              }}
            >
              削除
            </button>
          </div>
          <SpecFields spec={s} edit={(fn) => edit(s.id, fn)} />
        </div>
      ))}
    </section>
  );
}

function SpecFields({ spec: s, edit }: { spec: Spec; edit: (fn: (s: Spec) => void) => void }) {
  if (s.kind === "perimeter") {
    return (
      <div className="btn-row">
        <label className="field">
          線熱貫流率 ψ [W/(m・K)]
          <NumInput value={s.psi} onChange={(v) => edit((x) => void (x.psi = v))} />
        </label>
        <Note s={s} edit={edit} />
      </div>
    );
  }
  if (s.kind === "doma") {
    return (
      <div className="btn-row">
        <span className="muted small">土間床は面積を外皮面積に算入し、熱損失は「土間床等の外周部」の ψ で計上します。</span>
        <Note s={s} edit={edit} />
      </div>
    );
  }
  if (s.kind === "window" || s.kind === "door") {
    return (
      <div className="btn-row">
        <label className="field">
          熱貫流率 U [W/(㎡・K)]
          <NumInput value={s.u} onChange={(v) => edit((x) => void (x.u = v))} />
        </label>
        {s.kind === "window" && (
          <>
            <label className="field">
              垂直面日射熱取得率 ηd
              <NumInput value={s.etaD} onChange={(v) => edit((x) => void (x.etaD = v))} />
            </label>
            <label className="field">
              取得日射熱補正係数 冷房 fC
              <NumInput value={s.fC} onChange={(v) => edit((x) => void (x.fC = v))} />
            </label>
            <label className="field">
              暖房 fH
              <NumInput value={s.fH} onChange={(v) => edit((x) => void (x.fH = v))} />
            </label>
          </>
        )}
        <Note s={s} edit={edit} />
      </div>
    );
  }
  if (s.method === "direct") {
    return (
      <div className="btn-row">
        <label className="field">
          熱貫流率 U [W/(㎡・K)]
          <NumInput value={s.u} onChange={(v) => edit((x) => void (x.u = v))} />
        </label>
        <Note s={s} edit={edit} />
      </div>
    );
  }
  const r = layersU(s);
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>材料（室内側から）</th>
              <th className="num">厚さ [mm]</th>
              <th className="num">λ</th>
              <th className="num">熱橋部 λ</th>
              <th className="num">R = d/λ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.layers.map((l, i) => (
              <tr key={l.id}>
                <td>
                  <input
                    list="materials"
                    value={l.name}
                    onChange={(e) =>
                      edit((x) => {
                        const ly = x.layers[i];
                        ly.name = e.target.value;
                        const m = MATERIALS.find((mm) => mm.name === e.target.value);
                        if (m) ly.lambda = m.lambda;
                      })
                    }
                  />
                </td>
                <td className="num">
                  <NumInput value={l.thickness} onChange={(v) => edit((x) => void (x.layers[i].thickness = v))} />
                </td>
                <td className="num">
                  <NumInput value={l.lambda} onChange={(v) => edit((x) => void (x.layers[i].lambda = v))} />
                </td>
                <td className="num">
                  <NumInput
                    value={l.bridgeLambda ?? 0}
                    onChange={(v) => edit((x) => void (x.layers[i].bridgeLambda = v > 0 ? v : null))}
                  />
                </td>
                <td className="num">{l.lambda > 0 ? fmt(l.thickness / 1000 / l.lambda, 3) : "―"}</td>
                <td>
                  <button className="btn small danger" onClick={() => edit((x) => void x.layers.splice(i, 1))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="materials">
          {MATERIALS.map((m) => (
            <option key={m.name} value={m.name}>
              λ {m.lambda}
            </option>
          ))}
        </datalist>
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn small"
          onClick={() => edit((x) => void x.layers.push({ id: newId("ly"), name: "", thickness: 0, lambda: 0, bridgeLambda: null }))}
        >
          ＋ 層を追加
        </button>
        <label className="field">
          室内側 Ri
          <NumInput value={s.ri} onChange={(v) => edit((x) => void (x.ri = v))} />
        </label>
        <label className="field">
          外気側 Ro
          <NumInput value={s.ro} onChange={(v) => edit((x) => void (x.ro = v))} />
        </label>
        <label className="field">
          一般部の面積比率
          <NumInput value={s.ratio} onChange={(v) => edit((x) => void (x.ratio = v))} />
        </label>
        <span className="small muted">
          一般部 R = {fmt(r.rGeneral, 3)}／熱橋部 R = {fmt(r.rBridge, 3)} → U = {fmt(s.ratio, 2)}/{fmt(r.rGeneral, 3)} + {fmt(1 - s.ratio, 2)}/
          {fmt(r.rBridge, 3)} = <b>{fmt(r.u, 3)}</b>
        </span>
      </div>
      <Note s={s} edit={edit} />
    </>
  );
}

function Note({ s, edit }: { s: Spec; edit: (fn: (s: Spec) => void) => void }) {
  return (
    <label className="field" style={{ flex: 1, minWidth: 200 }}>
      備考
      <input value={s.note} onChange={(e) => edit((x) => void (x.note = e.target.value))} />
    </label>
  );
}
