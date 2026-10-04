import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../paths';

interface Entry<T> { at: number; value: T }

/** 外部APIの結果を data/cache/*.json に保存する簡易キャッシュ */
export class JsonCache<T> {
  private map = new Map<string, Entry<T>>();
  private file: string;
  private timer?: NodeJS.Timeout;

  constructor(name: string, private ttlMs: number) {
    this.file = path.join(DATA_DIR, 'cache', `${name}.json`);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, Entry<T>>;
      for (const [k, v] of Object.entries(raw)) this.map.set(k, v);
    } catch {
      // キャッシュがなければ空で開始
    }
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T) {
    this.map.set(key, { at: Date.now(), value });
    this.scheduleSave();
  }

  private scheduleSave() {
    if (process.env.VITEST) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map)));
    }, 1000);
  }
}
