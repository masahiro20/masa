"use client";

import { NumInput } from "../../NumInput";
import { REGIONS } from "@/lib/gaihi/constants";
import type { Project, Region } from "@/lib/gaihi/types";
import { Row, Section, Seg } from "../ui";

type Update = (fn: (p: Project) => void) => void;

export function StepBasic({ project, update }: { project: Project; update: Update }) {
  const set = <K extends keyof Project>(k: K, v: Project[K]) => update((p) => void (p[k] = v));
  return (
    <>
      <Section title="基本情報　入力">
        <Row label="記入年月日">
          <input type="date" value={project.date} onChange={(e) => set("date", e.target.value)} />
        </Row>
        <Row label="作成者">
          <input style={{ width: "100%" }} value={project.author} onChange={(e) => set("author", e.target.value)} />
        </Row>
        <Row label="住宅名称">
          <input style={{ width: "100%" }} value={project.name} onChange={(e) => set("name", e.target.value)} />
        </Row>
        <Row label="住宅建設地">
          <input style={{ width: "100%" }} value={project.address} onChange={(e) => set("address", e.target.value)} />
        </Row>
        <Row label="地域区分">
          <Seg<Region> className="region" value={project.region} options={REGIONS.map((r) => ({ value: r, label: String(r) }))} onChange={(v) => set("region", v)} />
        </Row>
        <Row label="建物の振り">
          <div className="rot">
            {([0, 45] as const).map((deg) => (
              <button key={deg} type="button" className={project.rotation === deg ? "on" : ""} onClick={() => set("rotation", deg)} aria-pressed={project.rotation === deg}>
                <span />
                <span>北</span>
                <span />
                <span>西</span>
                <span className="sq">
                  <span className={`bld${deg === 45 ? " diamond" : ""}`}>
                    <span>
                      建物
                      <br />
                      {deg}°の振り
                    </span>
                  </span>
                </span>
                <span>東</span>
                <span />
                <span>南</span>
                <span />
              </button>
            ))}
          </div>
        </Row>
        <Row label="構法">
          <Seg
            value={project.framing}
            options={[
              { value: "jikugumi", label: "軸組" },
              { value: "wakugumi", label: "枠組" },
            ]}
            onChange={(v) => set("framing", v)}
          />
        </Row>
        <Row label="屋根断熱 or 天井断熱">
          <Seg
            value={project.topInsulation}
            options={[
              { value: "roof", label: "屋根" },
              { value: "ceiling", label: "天井" },
              { value: "both", label: "両方" },
            ]}
            onChange={(v) => set("topInsulation", v)}
          />
        </Row>
        <Row label="床断熱 or 基礎断熱">
          <Seg
            value={project.insulationType}
            options={[
              { value: "floor", label: "床断熱" },
              { value: "foundation", label: "基礎断熱" },
            ]}
            onChange={(v) => set("insulationType", v)}
          />
        </Row>
        <Row
          label={
            <>
              オーバーハング床
              <br />
              <span className="ez-note">（外気に接する床）</span>
            </>
          }
        >
          <Seg
            value={project.overhang ? "y" : "n"}
            options={[
              { value: "y", label: "あり" },
              { value: "n", label: "なし" },
            ]}
            onChange={(v) => set("overhang", v === "y")}
          />
        </Row>
        <Row label="延床面積">
          <span className="flex">
            <NumInput value={project.totalFloorArea} onChange={(v) => set("totalFloorArea", v)} />㎡
          </span>
        </Row>
        <Row label={<>日射熱取得率と<br />熱貫流率の計算方法</>}>
          <span className="small">省エネ基準に準じた計算（申請用）</span>
        </Row>
      </Section>

      {project.notes.length > 0 && (
        <Section title="図面読み取りメモ">
          <div className="notice info">
            <ul>
              {project.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <button className="ez-btn small ghost" onClick={() => update((p) => void (p.notes = []))}>
            <span className="label">メモを消す</span>
          </button>
        </Section>
      )}
    </>
  );
}
