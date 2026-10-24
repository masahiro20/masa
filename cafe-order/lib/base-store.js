// 保存先に依存しない部分（初期データ・番号札・履歴のキャッシュ）。
// サーバーではファイル（store.js）、ブラウザのデモでは localStorage に保存する。
import { seedData, defaultSettings } from './seed.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function randomToken(bytes = 6) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += B64[b & 63];
  return out;
}

export function newId(prefix = '') {
  return prefix + randomToken(8);
}

export function newTagKey() {
  return randomToken(12);
}

export class BaseStore {
  constructor() {
    this.history = new Map(); // bizDate -> checks[]
    this.timer = null;
  }

  // 読み込んだ状態（なければ初期データ）を整える
  init(state) {
    if (!state) {
      const { categories, items } = seedData();
      state = {
        version: 1, settings: defaultSettings(), categories, items,
        tags: [], openChecks: [], pendingServe: [], calls: [], sessions: {},
      };
    }
    // 新しい設定項目が増えた時のために既定値で補完
    const def = defaultSettings();
    state.settings = { ...def, ...state.settings, ticket: { ...def.ticket, ...state.settings.ticket }, receipt: { ...def.receipt, ...state.settings.receipt } };
    state.calls ||= [];
    state.pendingServe ||= [];
    state.sessions ||= {};
    this.state = state;
    this.syncTags();
  }

  // 番号札の枚数に合わせて札（とQR用キー）を用意する
  syncTags() {
    const n = Math.max(1, Math.min(200, Number(this.state.settings.tagCount) || 20));
    const byNo = new Map(this.state.tags.map((t) => [t.no, t]));
    const tags = [];
    for (let no = 1; no <= n; no++) tags.push(byNo.get(no) || { no, key: newTagKey() });
    this.state.tags = tags;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    this.writeState(JSON.stringify(this.state));
  }

  getHistory(bizDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) throw new Error('bad date');
    if (!this.history.has(bizDate)) this.history.set(bizDate, this.readHistory(bizDate));
    return this.history.get(bizDate);
  }

  saveHistory(bizDate) {
    this.writeHistory(bizDate, JSON.stringify(this.getHistory(bizDate)));
  }

  // ---- 保存先ごとに実装する ----
  writeState() { throw new Error('not implemented'); }
  readHistory() { return []; }
  writeHistory() { throw new Error('not implemented'); }
  historyDates() { return []; }
  saveUpload() { throw new Error('この環境では画像を保存できません'); }
}
