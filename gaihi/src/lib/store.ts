"use client";

import type { Project } from "./gaihi/types";

// 物件データはブラウザの localStorage に保存する（サーバーには保存しない）。
// 別の端末で使うときは「JSONで保存」→「JSONを読み込む」で持ち運ぶ。

const KEY = "gaihi.projects.v1";

function readAll(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: Project[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): Project[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(id: string): Project | undefined {
  return readAll().find((p) => p.id === id);
}

export function saveProject(p: Project): boolean {
  const list = readAll().filter((x) => x.id !== p.id);
  list.push({ ...p, updatedAt: new Date().toISOString() });
  return writeAll(list);
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

export function downloadText(filename: string, text: string, type = "application/json") {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
