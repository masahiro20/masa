// JSONファイルによる保存。1店舗分なのでDBサーバー不要。
//  data/state.json             … 設定・メニュー・番号札・営業中の伝票・呼び出し
//  data/checks/YYYY-MM-DD.json … 会計済みの伝票（営業日ごと）
import fs from 'node:fs';
import path from 'node:path';
import { BaseStore, newId } from './base-store.js';

export { newId, newTagKey } from './base-store.js';

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class Store extends BaseStore {
  constructor(dir) {
    super();
    this.dir = dir;
    this.checksDir = path.join(dir, 'checks');
    this.uploadsDir = path.join(dir, 'uploads');
    fs.mkdirSync(this.checksDir, { recursive: true });
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.init(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null);
    this.saveNow();
  }

  writeState(json) {
    writeAtomic(this.file, json);
  }

  readHistory(bizDate) {
    const f = path.join(this.checksDir, `${bizDate}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  }

  writeHistory(bizDate, json) {
    writeAtomic(path.join(this.checksDir, `${bizDate}.json`), json);
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
