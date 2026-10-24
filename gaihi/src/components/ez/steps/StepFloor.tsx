"use client";

import type { Adjacency, Project } from "@/lib/gaihi/types";
import { MainSpec } from "../SpecEditor";
import { Section } from "../ui";
import { PerimeterTable, SurfaceTable } from "./common";

type Update = (fn: (p: Project) => void) => void;

export function StepFloor({ project, update }: { project: Project; update: Update }) {
  const floorAdj: Adjacency[] = project.overhang ? ["underfloor", "outside", "unheated"] : ["underfloor", "unheated"];
  return (
    <>
      <Section title={project.insulationType === "floor" ? "床　入力" : "床（基礎断熱の場合は床下を室内とみなす）"}>
        <MainSpec
          project={project}
          update={update}
          kind="floor"
          title="床の主たる仕様"
          apply={(p, id) => p.surfaces.forEach((s) => s.kind === "floor" && (s.specId = id))}
        />
        <div className="ez-sub">【床の面積】</div>
        <p className="ez-note">
          床組がある部分の面積（玄関・土間収納・基礎断熱の浴室を除く）。{project.overhang ? "オーバーハング床は隣接空間を「外気」にしてください。" : ""}
        </p>
        <SurfaceTable
          project={project}
          update={update}
          kinds={["floor"]}
          addKind="floor"
          addDefaults={{ name: "1階床", orientation: "BOTTOM", adjacency: "underfloor" }}
          adjacencies={floorAdj}
          addLabel="床の追加"
        />
      </Section>

      <Section title="基礎・玄関土間　入力">
        <div className="ez-sub">【土間床の面積】（玄関・土間収納・基礎断熱の浴室）</div>
        <SurfaceTable
          project={project}
          update={update}
          kinds={["doma"]}
          addKind="doma"
          addDefaults={{ name: "玄関土間", orientation: "BOTTOM", adjacency: "underfloor" }}
          adjacencies={["underfloor", "outside"]}
          addLabel="土間の追加"
        />
        <div style={{ height: 12 }} />
        <MainSpec
          project={project}
          update={update}
          kind="perimeter"
          title="土間床等の外周部の主たる仕様"
          apply={(p, id) => p.perimeters.forEach((x) => (x.specId = id))}
        />
        <div className="ez-sub">【土間床等の外周部の長さ】</div>
        <p className="ez-note">外気に接する辺は方位ごとに、床下に接する辺は隣接空間「床下」で入れます。</p>
        <PerimeterTable project={project} update={update} />
        <div style={{ height: 12 }} />
        <MainSpec
          project={project}
          update={update}
          kind="baseWall"
          title="基礎壁の主たる仕様"
          apply={(p, id) => p.surfaces.forEach((s) => s.kind === "baseWall" && (s.specId = id))}
        />
        <div className="ez-sub">【基礎壁の面積】（基礎断熱部分の立上り・地上部分）</div>
        <SurfaceTable
          project={project}
          update={update}
          kinds={["baseWall"]}
          addKind="baseWall"
          addDefaults={{ name: "基礎壁 玄関", orientation: project.rotation === 45 ? "SE" : "S", adjacency: "outside" }}
          adjacencies={["outside", "underfloor"]}
          showOrientation
          addLabel="基礎壁の追加"
        />
      </Section>
    </>
  );
}
