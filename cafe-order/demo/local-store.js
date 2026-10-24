// ブラウザ版デモの保存先。localStorage に保存し、同じブラウザの別画面（iPad枠・スマホ枠）と共有する。
import { BaseStore } from '../lib/base-store.js';

const mem = new Map(); // localStorage が使えない時の代わり
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
};

export class LocalStore extends BaseStore {
  constructor(prefix) {
    super();
    this.prefix = prefix;
    this.reload();
  }

  // 他の画面が書き込んだ最新の状態を読み直す
  reload() {
    const raw = ls.get(`${this.prefix}state`);
    this.history.clear();
    this.init(raw ? JSON.parse(raw) : null);
  }

  // 書き込みはリクエストごとにまとめて行う
  save() {}
  writeState(json) { ls.set(`${this.prefix}state`, json); }
  readHistory(d) { const raw = ls.get(`${this.prefix}h:${d}`); return raw ? JSON.parse(raw) : []; }
  writeHistory(d, json) {
    ls.set(`${this.prefix}h:${d}`, json);
    const dates = new Set(this.historyDates());
    dates.add(d);
    ls.set(`${this.prefix}dates`, JSON.stringify([...dates].sort()));
  }
  historyDates() { return JSON.parse(ls.get(`${this.prefix}dates`) || '[]'); }
}
