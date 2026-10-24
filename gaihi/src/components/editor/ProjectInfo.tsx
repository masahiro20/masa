"use client";

import { NumInput } from "../NumInput";
import { REGIONS } from "@/lib/gaihi/constants";
import type { Project, Region } from "@/lib/gaihi/types";

export function ProjectInfo({ project, update }: { project: Project; update: (fn: (p: Project) => void) => void }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>物件情報</h2>
      </div>
      <div className="grid-form">
        <label className="field">
          物件名
          <input value={project.name} onChange={(e) => update((p) => void (p.name = e.target.value))} />
        </label>
        <label className="field">
          建設地
          <input value={project.address} onChange={(e) => update((p) => void (p.address = e.target.value))} />
        </label>
        <label className="field">
          作成者
          <input value={project.author} onChange={(e) => update((p) => void (p.author = e.target.value))} />
        </label>
        <label className="field">
          地域の区分
          <select value={project.region} onChange={(e) => update((p) => void (p.region = Number(e.target.value) as Region))}>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}地域
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          構造
          <input value={project.structure} onChange={(e) => update((p) => void (p.structure = e.target.value))} />
        </label>
        <label className="field">
          断熱構造による住戸の種類
          <select
            value={project.insulationType}
            onChange={(e) => update((p) => void (p.insulationType = e.target.value as Project["insulationType"]))}
          >
            <option value="floor">床断熱住戸</option>
            <option value="foundation">基礎断熱住戸</option>
          </select>
        </label>
        <label className="field">
          延床面積 [㎡]
          <NumInput className="" value={project.totalFloorArea} onChange={(v) => update((p) => void (p.totalFloorArea = v))} />
        </label>
      </div>
      {project.notes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>図面読み取りメモ</h3>
          <div className="notice info">
            <ul>
              {project.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <button className="btn small" onClick={() => update((p) => void (p.notes = []))}>
            メモを消す
          </button>
        </div>
      )}
    </section>
  );
}
