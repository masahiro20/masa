import fs from 'node:fs';
import path from 'node:path';
import type { Listing } from '../../shared/types';
import { DATA_DIR } from '../paths';
import type { SourceAdapter } from './types';

let cache: Listing[] | undefined;

function load(): Listing[] {
  cache ??= JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sample-listings.json'), 'utf8')) as Listing[];
  return cache;
}

/** 動作確認用のサンプル物件（架空の物件。所在地は実在の町名の代表点） */
export const sampleSource: SourceAdapter = {
  id: 'sample',
  label: 'サンプルデータ',
  description: '首都圏の架空の土地物件（デモ用）。実在の物件ではありません。',
  enabled: () => process.env.LAND_FINDER_SAMPLE !== 'off',
  search: async () => load(),
  all: async () => load(),
};
