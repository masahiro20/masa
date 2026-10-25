"use client";

import { NumInput } from "../../NumInput";
import { AIR_HEAT_CAPACITY, INFILTRATION_PER_C, type CalcResult } from "@/lib/gaihi/calc";
import { newId, pickSpec } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";
import { fmt } from "@/lib/format";
import { MainSpec } from "../SpecEditor";
import { Row, Section } from "../ui";
import { SurfaceTable } from "./common";

type Update = (fn: (p: Project) => void) => void;

export function StepTop({ project, update, result }: { project: Project; update: Update; result: CalcResult }) {
  const useRoof = project.topInsulation !== "ceiling";
  const useCeiling = project.topInsulation !== "roof";
  const v = project.ventilation;
  const setV = (k: keyof typeof v, val: number) => update((p) => void (p.ventilation[k] = val));
  const volume = v.volume > 0 ? v.volume : project.totalFloorArea * 2.4;

  return (
    <>
      <Section title={`${[useCeiling && "天井", useRoof && "屋根"].filter(Boolean).join("・")}　入力`}>
        {useCeiling && (
          <MainSpec
            project={project}
            update={update}
            kind="ceiling"
            title="天井の主たる仕様"
            apply={(p, id) => p.surfaces.forEach((s) => s.kind === "ceiling" && (s.specId = id))}
          />
        )}
        {useRoof && (
          <MainSpec
            project={project}
            update={update}
            kind="roof"
            title="屋根の主たる仕様"
            apply={(p, id) => p.surfaces.forEach((s) => s.kind === "roof" && (s.specId = id))}
          />
        )}
        <div className="ez-sub">【面積】</div>
        <p className="ez-note">断熱境界となる天井の水平投影面積（屋根断熱は勾配なりの面積）。下屋の天井も分けて入れられます。</p>
        <SurfaceTable
          project={project}
          update={update}
          kinds={["ceiling", "roof"]}
          addKind={useCeiling ? "ceiling" : "roof"}
          addDefaults={{ name: useCeiling ? "2階天井" : "屋根", orientation: "TOP", adjacency: "outside" }}
          adjacencies={["outside", "unheated"]}
          addLabel={useCeiling ? "天井の追加" : "屋根の追加"}
        />
        {useRoof && useCeiling && (
          <div style={{ marginTop: 6 }}>
            <button
              className="ez-btn small ghost"
              onClick={() =>
                update((p) => {
                  p.surfaces.push({
                    id: newId("sf"),
                    name: "屋根",
                    kind: "roof",
                    specId: pickSpec(p.specs, "roof")?.id ?? "",
                    orientation: "TOP",
                    area: 0,
                    adjacency: "outside",
                    basis: "",
                  });
                })
              }
            >
              <span className="label">＋ 屋根も追加</span>
            </button>
          </div>
        )}
      </Section>

      <Section title="換気　入力（Q値の計算用）">
        <Row label="気積">
          <span className="flex">
            <NumInput value={v.volume} onChange={(x) => setV("volume", x)} />㎥
            <span className="ez-note">0 のときは延床面積 × 2.4m（{fmt(volume, 1)}㎥）で計算</span>
          </span>
        </Row>
        <Row label="換気回数">
          <span className="flex">
            <NumInput value={v.rate} onChange={(x) => setV("rate", x)} />
            回/h
          </span>
        </Row>
        <Row label="熱交換換気の効率">
          <span className="flex">
            <NumInput value={v.heatRecovery} onChange={(x) => setV("heatRecovery", x)} />
            <span className="ez-note">0〜1（第3種換気は 0、効率80%なら 0.8）</span>
          </span>
        </Row>
        <Row label="C値（相当隙間面積）">
          <span className="flex">
            <NumInput value={v.cValue} onChange={(x) => setV("cValue", x)} />
            c㎡/㎡
          </span>
        </Row>
        <p className="ez-note" style={{ marginTop: 8 }}>
          換気・漏気の熱損失 = {AIR_HEAT_CAPACITY} ×（換気回数 ×（1 − 効率）+ C値 × {INFILTRATION_PER_C}）× 気積 = {fmt(result.ventLoss, 2)} W/K。
          Q値 =（総熱損失量 q + 換気・漏気の熱損失）÷ 延床面積（参考値）
        </p>
      </Section>
    </>
  );
}
