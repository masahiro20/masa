"use client";

import { useState } from "react";
import { NumInput } from "../../NumInput";
import { hostSurface, openingArea } from "@/lib/gaihi/calc";
import { ORIENTATION_LABEL, ROTATION_DIRS, WALL_ORIENTATIONS } from "@/lib/gaihi/constants";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Opening, Orientation, Project, Surface } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { MainSpec } from "../SpecEditor";
import { DeleteX, EzButton, Modal, Section } from "../ui";

type Update = (fn: (p: Project) => void) => void;

export function StepWalls({ project, update }: { project: Project; update: Update }) {
  const [batch, setBatch] = useState(false);
  const used = new Set<Orientation>([
    ...project.surfaces.filter((s) => s.kind === "wall").map((s) => s.orientation),
    ...project.openings.map((o) => o.orientation),
  ]);
  const dirs = [...ROTATION_DIRS[project.rotation], ...WALL_ORIENTATIONS.filter((d) => used.has(d) && !ROTATION_DIRS[project.rotation].includes(d))];
  const walls = project.surfaces.filter((s) => s.kind === "wall");
  const totalWall = walls.reduce((a, s) => a + s.area, 0);
  const totalOpen = project.openings.reduce((a, o) => a + openingArea(o), 0);

  return (
    <>
      <Section title="外壁　入力">
        <MainSpec
          project={project}
          update={update}
          kind="wall"
          title="外壁の主たる仕様"
          apply={(p, id) => p.surfaces.forEach((s) => s.kind === "wall" && (s.specId = id))}
        />
      </Section>

      <Section
        title="窓・ドア　入力"
        right={<EzButton small icon="grid" label="窓まとめて作成" onClick={() => setBatch(true)} />}
      >
        <MainSpec
          project={project}
          update={update}
          kind="window"
          title="窓の主たる仕様"
          apply={(p, id) => p.openings.forEach((o) => o.kind === "window" && (o.specId = id))}
        />
        <MainSpec
          project={project}
          update={update}
          kind="door"
          title="ドアの主たる仕様"
          apply={(p, id) => p.openings.forEach((o) => o.kind === "door" && (o.specId = id))}
        />
      </Section>

      <Section title={`方位別の外壁面積・開口部（外壁 ${fmt(totalWall)}㎡ ／ 開口部 ${fmt(totalOpen)}㎡）`}>
        <p className="ez-note">外壁は開口部を含むグロス面積を入れてください（妻壁の三角形部分を含む）。開口部の面積は同じ方位の外壁から自動で差し引きます。</p>
        {dirs.map((d) => (
          <DirectionCard key={d} dir={d} project={project} update={update} />
        ))}
      </Section>

      {batch && <WindowBatchModal project={project} update={update} onClose={() => setBatch(false)} />}
    </>
  );
}

function DirectionCard({ dir, project, update }: { dir: Orientation; project: Project; update: Update }) {
  const walls = project.surfaces.filter((s) => s.kind === "wall" && s.orientation === dir);
  const openings = project.openings.filter((o) => (hostSurface(project, o)?.orientation ?? o.orientation) === dir);
  const gross = walls.reduce((a, s) => a + s.area, 0);
  const open = openings.reduce((a, o) => a + openingArea(o), 0);
  const editWall = (id: string, fn: (s: Surface) => void) =>
    update((p) => {
      const s = p.surfaces.find((x) => x.id === id);
      if (s) fn(s);
    });
  const editOpening = (id: string, fn: (o: Opening) => void) =>
    update((p) => {
      const o = p.openings.find((x) => x.id === id);
      if (o) fn(o);
    });
  const addWall = () =>
    update(
      (p) =>
        void p.surfaces.push({
          id: newId("sf"),
          name: `外壁 ${ORIENTATION_LABEL[dir]}`,
          kind: "wall",
          specId: pickSpec(p.specs, "wall")?.id ?? "",
          orientation: dir,
          area: 0,
          adjacency: "outside",
          basis: "",
        }),
    );
  const addOpening = (kind: Opening["kind"]) =>
    update((p) => {
      const host = p.surfaces.find((s) => s.kind === "wall" && s.orientation === dir);
      p.openings.push({
        id: newId("op"),
        name: kind === "door" ? "ドア" : `窓${openings.filter((o) => o.kind === "window").length + 1}`,
        kind,
        specId: pickSpec(p.specs, kind)?.id ?? "",
        orientation: dir,
        width: kind === "door" ? 0.92 : 1.69,
        height: kind === "door" ? 2.33 : 1.17,
        count: 1,
        surfaceId: host?.id ?? null,
        basis: "",
      });
    });

  return (
    <div className="dir-card">
      <div className="dir-head">
        <span className="dir-pill">{ORIENTATION_LABEL[dir]}</span>
        外壁 {fmt(gross)}㎡ − 開口部 {fmt(open)}㎡ ＝ <span style={{ color: gross - open < 0 ? "var(--bad)" : undefined }}>{fmt(gross - open)}㎡</span>
        <span className="spacer" />
        <EzButton small icon="plus" label="外壁" onClick={addWall} />
        <EzButton small icon="plus" label="窓" onClick={() => addOpening("window")} />
        <EzButton small icon="plus" label="ドア" onClick={() => addOpening("door")} />
      </div>
      <div className="dir-body">
        {walls.length === 0 && openings.length === 0 && <div className="ez-note">この方位の外壁・窓はまだありません。</div>}
        {walls.length > 0 && (
          <table className="ez-table" style={{ marginBottom: 6 }}>
            <thead>
              <tr>
                <th>外壁</th>
                <th style={{ width: 90 }}>面積(㎡)</th>
                <th style={{ width: 130 }}>隣接空間</th>
                <th>根拠</th>
                <th style={{ width: 40 }}>削除</th>
              </tr>
            </thead>
            <tbody>
              {walls.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input value={s.name} onChange={(e) => editWall(s.id, (x) => void (x.name = e.target.value))} />
                    <select value={s.specId} onChange={(e) => editWall(s.id, (x) => void (x.specId = e.target.value))} style={{ marginTop: 3 }}>
                      {project.specs
                        .filter((sp) => sp.kind === "wall")
                        .map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="num">
                    <NumInput value={s.area} onChange={(v) => editWall(s.id, (x) => void (x.area = v))} className="w-num" />
                  </td>
                  <td>
                    <select value={s.adjacency} onChange={(e) => editWall(s.id, (x) => void (x.adjacency = e.target.value as Surface["adjacency"]))}>
                      <option value="outside">外気</option>
                      <option value="unheated">外気に通じていない空間</option>
                      <option value="neighbor">住戸と同様の熱的環境</option>
                    </select>
                  </td>
                  <td>
                    <input value={s.basis} onChange={(e) => editWall(s.id, (x) => void (x.basis = e.target.value))} placeholder="例：X0-X6 5,460 × 5.80m" />
                  </td>
                  <td className="center">
                    <DeleteX onClick={() => update((p) => void (p.surfaces = p.surfaces.filter((x) => x.id !== s.id)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {openings.length > 0 && (
          <table className="ez-table">
            <thead>
              <tr>
                <th>窓・ドア</th>
                <th style={{ width: 74 }}>幅(m)</th>
                <th style={{ width: 74 }}>高さ(m)</th>
                <th style={{ width: 56 }}>枚数</th>
                <th style={{ width: 60 }}>面積</th>
                <th style={{ width: 40 }}>削除</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div className="flex" style={{ flexWrap: "nowrap", gap: 4 }}>
                      <select
                        style={{ width: 64, flex: "none" }}
                        value={o.kind}
                        onChange={(e) =>
                          editOpening(o.id, (x) => {
                            x.kind = e.target.value as Opening["kind"];
                            x.specId = pickSpec(project.specs, x.kind)?.id ?? "";
                          })
                        }
                      >
                        <option value="window">窓</option>
                        <option value="door">ドア</option>
                      </select>
                      <input value={o.name} onChange={(e) => editOpening(o.id, (x) => void (x.name = e.target.value))} />
                    </div>
                    <select value={o.specId} onChange={(e) => editOpening(o.id, (x) => void (x.specId = e.target.value))} style={{ marginTop: 3 }}>
                      {project.specs
                        .filter((sp) => sp.kind === o.kind)
                        .map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                    </select>
                    {o.basis && <div className="basis">{o.basis}</div>}
                  </td>
                  <td className="num">
                    <NumInput value={o.width} onChange={(v) => editOpening(o.id, (x) => void (x.width = v))} className="w-num" />
                  </td>
                  <td className="num">
                    <NumInput value={o.height} onChange={(v) => editOpening(o.id, (x) => void (x.height = v))} className="w-num" />
                  </td>
                  <td className="num">
                    <NumInput step="1" value={o.count} onChange={(v) => editOpening(o.id, (x) => void (x.count = Math.max(1, Math.round(v))))} className="w-num" />
                  </td>
                  <td className="num">{fmt(openingArea(o))}</td>
                  <td className="center">
                    <DeleteX onClick={() => update((p) => void (p.openings = p.openings.filter((x) => x.id !== o.id)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** 窓まとめて作成：方位ごとの枚数と仕様・寸法を指定して一度に作る */
function WindowBatchModal({ project, update, onClose }: { project: Project; update: Update; onClose: () => void }) {
  const dirs = ROTATION_DIRS[project.rotation];
  const windowSpecs = project.specs.filter((s) => s.kind === "window");
  const [counts, setCounts] = useState<Record<string, number>>(Object.fromEntries(dirs.map((d) => [d, 0])));
  const [specId, setSpecId] = useState(windowSpecs[0]?.id ?? "");
  const [w, setW] = useState(1.69);
  const [h, setH] = useState(1.17);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <Modal
      title="窓まとめて作成"
      onClose={onClose}
      width={520}
      footer={
        <>
          <EzButton icon="back" label="キャンセル" onClick={onClose} />
          <EzButton
            icon="check"
            label="OK"
            disabled={total === 0 || !specId}
            onClick={() => {
              update((p) => {
                for (const d of dirs) {
                  const host = p.surfaces.find((s) => s.kind === "wall" && s.orientation === d);
                  for (let i = 0; i < counts[d]; i++) {
                    p.openings.push({
                      id: newId("op"),
                      name: `窓 ${ORIENTATION_LABEL[d]}${i + 1}`,
                      kind: "window",
                      specId,
                      orientation: d,
                      width: w,
                      height: h,
                      count: 1,
                      surfaceId: host?.id ?? null,
                      basis: "窓まとめて作成",
                    });
                  }
                }
              });
              onClose();
            }}
          />
        </>
      }
    >
      <p>作成する窓の方位・枚数と、仕様を指定してください。</p>
      <p className="ez-note">（窓は各方位 30 枚まで作成できます。寸法は作成後に1枚ずつ直せます）</p>
      {dirs.map((d) => (
        <div className="flex" key={d} style={{ margin: "10px 0", justifyContent: "center" }}>
          <span style={{ width: 44, textAlign: "center" }}>{ORIENTATION_LABEL[d]}</span>
          <select className="ez-select" style={{ width: 160 }} value={counts[d]} onChange={(e) => setCounts((c) => ({ ...c, [d]: Number(e.target.value) }))}>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <span>枚</span>
        </div>
      ))}
      <div className="flex" style={{ margin: "16px 0 8px", justifyContent: "center" }}>
        <span style={{ width: 80 }}>窓仕様</span>
        <select className="ez-select" style={{ width: 300 }} value={specId} onChange={(e) => setSpecId(e.target.value)}>
          {windowSpecs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex" style={{ justifyContent: "center" }}>
        <span style={{ width: 80 }}>寸法</span>幅
        <NumInput value={w} onChange={setW} />m × 高さ
        <NumInput value={h} onChange={setH} />m
      </div>
    </Modal>
  );
}
