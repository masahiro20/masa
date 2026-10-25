"use client";

import { useState } from "react";
import { NumInput } from "../NumInput";
import { layersU, specValue } from "@/lib/gaihi/calc";
import { LAYER_CATEGORY_LABEL, MATERIALS, SPEC_KIND_LABEL } from "@/lib/gaihi/constants";
import { blankSpec, layer, newId } from "@/lib/gaihi/defaults";
import { specTemplates } from "@/lib/gaihi/specText";
import type { LayerCategory, Project, Spec, SpecKind } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { DeleteX, EzButton, Modal, Seg } from "./ui";

type Update = (fn: (p: Project) => void) => void;

const LAYERED: SpecKind[] = ["ceiling", "roof", "wall", "floor", "baseWall"];
const CATEGORIES = Object.keys(LAYER_CATEGORY_LABEL) as LayerCategory[];

/** 仕様1件の編集（U値の直接入力、または材料構成の表） */
export function SpecEditor({ spec: s, update }: { spec: Spec; update: Update }) {
  const edit = (fn: (x: Spec) => void) =>
    update((p) => {
      const x = p.specs.find((y) => y.id === s.id);
      if (x) fn(x);
    });

  if (s.kind === "perimeter") {
    return (
      <div className="flex">
        <span className="small">線熱貫流率 ψ</span>
        <NumInput value={s.psi} onChange={(v) => edit((x) => void (x.psi = v))} />
        <span className="small">W/(m・K)</span>
      </div>
    );
  }
  if (s.kind === "doma") return <div className="ez-note">土間床は面積だけを外皮面積に入れ、熱損失は「土間床等の外周部」の ψ で計上します。</div>;
  if (s.kind === "window" || s.kind === "door") {
    return (
      <div className="flex">
        <span className="small">熱貫流率 U</span>
        <NumInput value={s.u} onChange={(v) => edit((x) => void (x.u = v))} />
        {s.kind === "window" && (
          <>
            <span className="small">日射熱取得率 ηd</span>
            <NumInput value={s.etaD} onChange={(v) => edit((x) => void (x.etaD = v))} />
            <span className="small">補正係数 冷房 fC</span>
            <NumInput value={s.fC} onChange={(v) => edit((x) => void (x.fC = v))} />
            <span className="small">暖房 fH</span>
            <NumInput value={s.fH} onChange={(v) => edit((x) => void (x.fH = v))} />
          </>
        )}
        <div className="ez-note" style={{ width: "100%" }}>
          メーカーの自己適合宣言書（性能値）の U・ηd を入れてください。取得日射熱補正係数は庇等を計算しない場合の既定値（0.93 / 0.51）です。
        </div>
      </div>
    );
  }

  const r = layersU(s);
  return (
    <>
      {LAYERED.includes(s.kind) && (
        <div className="flex" style={{ marginBottom: 8 }}>
          <span className="small">●仕様入力</span>
          <Seg
            value={s.method}
            options={[
              { value: "layers", label: "材料構成から計算" },
              { value: "direct", label: "U値を直接入力" },
            ]}
            onChange={(v) => edit((x) => void (x.method = v))}
          />
        </div>
      )}
      {s.method === "direct" ? (
        <div className="flex">
          <span className="small">熱貫流率 U</span>
          <NumInput value={s.u} onChange={(v) => edit((x) => void (x.u = v))} />
          <span className="small">W/(㎡・K)</span>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="ez-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>カテゴリ</th>
                  <th>材料名</th>
                  <th style={{ width: 70 }}>λ</th>
                  <th style={{ width: 80 }}>厚み(mm)</th>
                  <th style={{ width: 40 }}>削除</th>
                </tr>
              </thead>
              <tbody>
                <tr className="air">
                  <td colSpan={5}>室内側空気層（Ri = {s.ri}）</td>
                </tr>
                {s.layers.map((l, i) => {
                  const options = MATERIALS.filter((m) => m.category === l.category);
                  const preset = options.find((m) => m.name === l.name && m.lambda === l.lambda);
                  return (
                    <tr key={l.id}>
                      <td>
                        <select
                          className="ez-select small"
                          value={l.category}
                          onChange={(e) =>
                            edit((x) => {
                              const ly = x.layers[i];
                              ly.category = e.target.value as LayerCategory;
                              const first = MATERIALS.find((m) => m.category === ly.category);
                              if (first) {
                                ly.name = first.name;
                                ly.lambda = first.lambda;
                              }
                            })
                          }
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {LAYER_CATEGORY_LABEL[c]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="flex" style={{ flexWrap: "nowrap", gap: 4 }}>
                          <select
                            className="ez-select small"
                            style={{ flex: 1, minWidth: 140 }}
                            value={preset ? preset.name : "__manual"}
                            onChange={(e) =>
                              edit((x) => {
                                const m = options.find((o) => o.name === e.target.value);
                                if (m) {
                                  x.layers[i].name = m.name;
                                  x.layers[i].lambda = m.lambda;
                                } else {
                                  x.layers[i].name = `${x.layers[i].name}（手動）`;
                                }
                              })
                            }
                          >
                            {options.map((m) => (
                              <option key={m.name} value={m.name}>
                                {m.name}
                              </option>
                            ))}
                            <option value="__manual">手動設定</option>
                          </select>
                        </div>
                        {!preset && (
                          <input
                            style={{ marginTop: 3 }}
                            value={l.name}
                            placeholder="材料名"
                            onChange={(e) => edit((x) => void (x.layers[i].name = e.target.value))}
                          />
                        )}
                      </td>
                      <td className="num">
                        {preset ? (
                          fmt(l.lambda, 3)
                        ) : (
                          <NumInput value={l.lambda} onChange={(v) => edit((x) => void (x.layers[i].lambda = v))} className="w-num" />
                        )}
                      </td>
                      <td className="num">
                        <NumInput value={l.thickness} onChange={(v) => edit((x) => void (x.layers[i].thickness = v))} className="w-num" />
                      </td>
                      <td className="center">
                        <DeleteX onClick={() => edit((x) => void x.layers.splice(i, 1))} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="air">
                  <td colSpan={5}>室外側空気層（Ro = {s.ro}）</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex" style={{ marginTop: 8 }}>
            <EzButton
              small
              icon="check"
              label="行の追加"
              onClick={() => edit((x) => void x.layers.push(layer("board", "せっこうボード", 12.5, 0.221)))}
            />
            <span className="small">Ri</span>
            <NumInput value={s.ri} onChange={(v) => edit((x) => void (x.ri = v))} className="w-num" />
            <span className="small">Ro</span>
            <NumInput value={s.ro} onChange={(v) => edit((x) => void (x.ro = v))} className="w-num" />
            {r.hasBridge && (
              <>
                <span className="small">一般部の面積比率</span>
                <NumInput value={s.ratio} onChange={(v) => edit((x) => void (x.ratio = v))} className="w-num" />
              </>
            )}
          </div>
          <div className="ez-note" style={{ marginTop: 6 }}>
            {r.hasBridge ? (
              <>
                一般部 R = {fmt(r.rGeneral, 3)}・熱橋部（軸材）R = {fmt(r.rBridge, 3)} → U = {fmt(s.ratio, 2)}÷{fmt(r.rGeneral, 3)} + {fmt(1 - s.ratio, 2)}÷
                {fmt(r.rBridge, 3)} = <b>{fmt(r.u, 3)}</b> W/(㎡・K)
              </>
            ) : (
              <>
                R = {fmt(r.rGeneral, 3)} → U = <b>{fmt(r.u, 3)}</b> W/(㎡・K)（軸材の行を足すと熱橋を考慮します）
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** 「仕様リストから選択」：登録済みの仕様を選ぶ・登録する・編集する */
export function SpecListModal({
  project,
  update,
  kinds,
  currentId,
  onSelect,
  onClose,
}: {
  project: Project;
  update: Update;
  kinds: SpecKind[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const list = project.specs.filter((s) => kinds.includes(s.kind));
  const templates = specTemplates().filter((t) => kinds.includes(t.kind));
  const [sel, setSel] = useState(currentId || list[0]?.id || "");
  const spec = project.specs.find((s) => s.id === sel);
  const used = (id: string) =>
    project.surfaces.some((s) => s.specId === id) || project.openings.some((o) => o.specId === id) || project.perimeters.some((x) => x.specId === id);

  return (
    <Modal
      title={`仕様リスト（${kinds.map((k) => SPEC_KIND_LABEL[k]).join("・")}）`}
      onClose={onClose}
      width={860}
      footer={
        <>
          <EzButton icon="back" label="キャンセル" onClick={onClose} />
          <EzButton
            icon="check"
            label="この仕様を使う"
            disabled={!spec}
            onClick={() => {
              onSelect(sel);
              onClose();
            }}
          />
        </>
      }
    >
      <table className="ez-table" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>選択</th>
            <th>仕様名</th>
            <th style={{ width: 90 }}>部位</th>
            <th style={{ width: 80 }}>U / ψ</th>
            <th style={{ width: 40 }}>削除</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id} style={s.id === sel ? { background: "#fff1dc" } : undefined}>
              <td className="center">
                <input type="radio" checked={s.id === sel} onChange={() => setSel(s.id)} aria-label={s.name} />
              </td>
              <td>
                <input value={s.name} onChange={(e) => update((p) => void (p.specs.find((x) => x.id === s.id)!.name = e.target.value))} />
              </td>
              <td className="center">{SPEC_KIND_LABEL[s.kind]}</td>
              <td className="num">{s.kind === "doma" ? "―" : fmt(specValue(s), 3)}</td>
              <td className="center">
                <DeleteX
                  onClick={() => {
                    if (used(s.id) && !confirm("この仕様は使われています。削除すると該当する部位は「仕様なし」になります。削除しますか？")) return;
                    update((p) => void (p.specs = p.specs.filter((x) => x.id !== s.id)));
                    if (sel === s.id) setSel("");
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex" style={{ marginBottom: 12 }}>
        {kinds.map((k) => (
          <EzButton
            key={k}
            small
            icon="plus"
            label={`${SPEC_KIND_LABEL[k]}の仕様を登録`}
            onClick={() => {
              const s = { ...blankSpec(k, `${SPEC_KIND_LABEL[k]}（新規）`), method: LAYERED.includes(k) ? ("layers" as const) : ("direct" as const) };
              update((p) => void p.specs.push(s));
              setSel(s.id);
            }}
          />
        ))}
        {templates.length > 0 && (
          <select
            className="ez-select small"
            style={{ minWidth: 260 }}
            value=""
            aria-label="テンプレートから追加"
            onChange={(e) => {
              const t = templates.find((x) => x.name === e.target.value);
              if (!t) return;
              const c = { ...structuredClone(t), id: newId("spec") };
              c.layers = c.layers.map((l) => ({ ...l, id: newId("ly") }));
              update((p) => void p.specs.push(c));
              setSel(c.id);
            }}
          >
            <option value="">テンプレートから追加…</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}（U {fmt(specValue(t), 3)}）
              </option>
            ))}
          </select>
        )}
        {spec && (
          <EzButton
            small
            icon="copy"
            label="選択中の仕様を複製"
            onClick={() => {
              const c = { ...structuredClone(spec), id: newId("spec"), name: `${spec.name}_コピー` };
              update((p) => void p.specs.push(c));
              setSel(c.id);
            }}
          />
        )}
      </div>
      {spec && (
        <>
          <div className="ez-sub">【{spec.name}】</div>
          <SpecEditor spec={spec} update={update} />
          <div style={{ marginTop: 8 }}>
            <input
              style={{ width: "100%" }}
              placeholder={
                spec.kind === "window" || spec.kind === "door"
                  ? "根拠・備考（例：〇〇社 △△ 樹脂サッシ Low-E複層 JIS A 4710 試験値）※申請用印刷に載ります"
                  : "根拠・備考（メーカー・品番、U値の出典など）※申請用印刷に載ります"
              }
              value={spec.note}
              onChange={(e) => update((p) => void (p.specs.find((x) => x.id === spec.id)!.note = e.target.value))}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

/** 各ステップの【〇〇の主たる仕様】ブロック */
export function MainSpec({
  project,
  update,
  kind,
  title,
  apply,
}: {
  project: Project;
  update: Update;
  kind: SpecKind;
  title: string;
  /** 主たる仕様を変えたとき、どの部位に当てはめるか */
  apply: (p: Project, specId: string) => void;
}) {
  const [modal, setModal] = useState(false);
  // 選んだ仕様を同じ部位の先頭に置く（新しく追加する部位にもこの仕様が付く）
  const choose = (id: string) =>
    update((p) => {
      apply(p, id);
      const i = p.specs.findIndex((s) => s.id === id);
      if (i > 0) p.specs.unshift(...p.specs.splice(i, 1));
    });
  const specs = project.specs.filter((s) => s.kind === kind);
  const templates = specTemplates().filter((t) => t.kind === kind && !specs.some((s) => s.name === t.name));
  const current = specs[0];

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="ez-sub">【{title}】</div>
      <div className="flex" style={{ marginBottom: 8 }}>
        <select
          className="ez-select"
          style={{ minWidth: 260 }}
          value={current?.id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const t = v.startsWith("tpl:") ? templates.find((x) => x.name === v.slice(4)) : undefined;
            if (!t) return choose(v);
            // テンプレートを選んだら仕様リストに登録してから当てはめる
            const c = { ...structuredClone(t), id: newId("spec"), layers: t.layers.map((l) => ({ ...l, id: newId("ly") })) };
            update((p) => {
              p.specs.unshift(c);
              apply(p, c.id);
            });
          }}
        >
          {specs.length === 0 && <option value="">（未登録）</option>}
          <optgroup label="登録済みの仕様">
            {specs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {templates.length > 0 && (
            <optgroup label="テンプレートから追加">
              {templates.map((t) => (
                <option key={t.name} value={`tpl:${t.name}`}>
                  {t.name}（U {fmt(specValue(t), 3)}）
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <EzButton small icon="check" label="仕様リストから選択" onClick={() => setModal(true)} />
        {current && <span className="small">{kind === "perimeter" ? `ψ = ${fmt(current.psi, 3)}` : kind === "doma" ? "" : `U = ${fmt(specValue(current), 3)}`}</span>}
      </div>
      {current && <SpecEditor spec={current} update={update} />}
      {modal && (
        <SpecListModal
          project={project}
          update={update}
          kinds={[kind]}
          currentId={current?.id ?? ""}
          onSelect={choose}
          onClose={() => setModal(false)}
        />
      )}
    </div>
  );
}
