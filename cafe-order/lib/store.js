// JSONファイルによる保存。1店舗分なのでDBサーバー不要。
//  data/state.json          … 設定・メニュー・番号札・営業中の伝票・呼び出し
//  data/checks/YYYY-MM-DD.json … 会計済みの伝票（営業日ごと）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { seedData, defaultSettings } from './seed.js';

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('base64url');
}

export function newTagKey() {
  return crypto.randomBytes(9).toString('base64url');
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.checksDir = path.join(dir, 'checks');
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.checksDir, { recursive: true });
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.history = new Map(); // bizDate -> checks[]
    this.timer = null;
    this.load();
  }

  load() {
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } else {
      const { categories, items } = seedData();
      this.state = {
        version: 1,
        settings: defaultSettings(),
        categories,
        items,
        tags: [],
        openChecks: [],
        pendingServe: [],
        calls: [],
        sessions: {},
      };
    }
    // 新しい設定項目が増えた時のために既定値で補完
    const def = defaultSettings();
    this.state.settings = { ...def, ...this.state.settings, ticket: { ...def.ticket, ...this.state.settings.ticket }, receipt: { ...def.receipt, ...this.state.settings.receipt } };
    this.state.calls ||= [];
    this.state.pendingServe ||= [];
    this.state.sessions ||= {};
    this.syncTags();
    this.saveNow();
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
    writeAtomic(this.file, JSON.stringify(this.state));
  }

  historyFile(bizDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bizDate)) throw new Error('bad date');
    return path.join(this.checksDir, `${bizDate}.json`);
  }

  getHistory(bizDate) {
    if (!this.history.has(bizDate)) {
      const f = this.historyFile(bizDate);
      this.history.set(bizDate, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
    }
    return this.history.get(bizDate);
  }

  saveHistory(bizDate) {
    writeAtomic(this.historyFile(bizDate), JSON.stringify(this.getHistory(bizDate)));
  }

  historyDates() {
    return fs.readdirSync(this.checksDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  }

  saveUpload(buf, ext) {
    const name = `${newId()}.${ext}`;
    fs.writeFileSync(path.join(this.uploadsDir, name), buf);
    return `/uploads/${name}`;
  }
}
