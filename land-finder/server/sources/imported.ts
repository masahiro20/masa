import fs from 'node:fs';
import path from 'node:path';
import type { Listing } from '../../shared/types';
import { DATA_DIR } from '../paths';
import type { SourceAdapter } from './types';

const FILE = path.join(DATA_DIR, 'imported.json');

function read(): Listing[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Listing[];
  } catch {
    return [];
  }
}

function write(list: Listing[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

/** CSV・URLから取り込んだ物件を保存する（data/imported.json） */
export const importedStore = {
  list: read,
  upsert(items: Listing[]) {
    const map = new Map(read().map((l) => [l.id, l]));
    for (const item of items) map.set(item.id, item);
    write([...map.values()]);
    return items.length;
  },
  remove(id: string) {
    const list = read();
    const next = list.filter((l) => l.id !== id);
    write(next);
    return list.length !== next.length;
  },
  clear() {
    write([]);
  },
};

export const importedSource: SourceAdapter = {
  id: 'import',
  label: '取り込み物件',
  description: 'CSV（土地バンク形式など）や物件ページURLから取り込んだ物件。',
  enabled: () => true,
  search: async () => importedStore.list(),
  all: async () => importedStore.list(),
};
