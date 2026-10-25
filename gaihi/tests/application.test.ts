import { describe, expect, it } from "vitest";
import { applicationChecks } from "@/lib/gaihi/application";
import { calculate } from "@/lib/gaihi/calc";
import { normalizeProject, sampleProject } from "@/lib/gaihi/defaults";
import type { Project } from "@/lib/gaihi/types";

const checks = (p: Project) => applicationChecks(p, calculate(p));

describe("申請前チェック", () => {
  it("基本事項の未入力は要修正", () => {
    const p = sampleProject();
    p.author = "";
    p.client = "";
    const c = checks(p);
    expect(c.some((x) => x.level === "error" && x.message.includes("建築主") && x.message.includes("作成者"))).toBe(true);
  });

  it("基本事項と根拠がそろえば要修正は出ない", () => {
    const p = sampleProject();
    p.author = "計算 花子";
    p.designer = "〇〇建築設計事務所";
    for (const s of p.specs) s.note ||= "カタログ値";
    expect(checks(p).filter((x) => x.level === "error")).toEqual([]);
  });

  it("居室の床面積が延床を超えたら要修正、土間があって外周部がなければ要修正", () => {
    const p = sampleProject();
    p.mainRoomArea = 100;
    p.otherRoomArea = 100;
    p.perimeters = [];
    const msgs = checks(p).filter((x) => x.level === "error").map((x) => x.message);
    expect(msgs.some((m) => m.includes("延床面積を超えて"))).toBe(true);
    expect(msgs.some((m) => m.includes("外周部"))).toBe(true);
  });

  it("前のデータ（建築主などの項目がない）も読み込める", () => {
    const old = { ...sampleProject() } as Partial<Project>;
    delete old.client;
    delete old.floors;
    const p = normalizeProject(old as Project);
    expect(p.client).toBe("");
    expect(p.floors).toBe(2);
  });
});
