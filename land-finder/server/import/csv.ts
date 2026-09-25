// CSV（土地バンク形式・各社の物件一覧エクスポート・手入力の表など）から物件を取り込む。
import Papa from 'papaparse';
import type { Listing } from '../../shared/types';
import { buildListing, toFieldMap } from './fields';

/** UTF-8 として不正なら Shift_JIS（Excel既定のCSV）として読む */
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

export interface CsvImportResult {
  listings: Listing[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  headers: string[];
}

export function parseCsv(text: string, sourceLabel = 'CSV取り込み'): CsvImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' });
  const headers = parsed.meta.fields ?? [];
  const listings: Listing[] = [];
  const errors: CsvImportResult['errors'] = [];
  const warnings: CsvImportResult['warnings'] = [];

  parsed.data.forEach((row, i) => {
    const rowNo = i + 2; // ヘッダー行を1行目とする
    const fields = toFieldMap(Object.entries(row).map(([k, v]) => [k, v ?? '']));
    const seed = fields.url ?? `${fields.address}-${fields.price}-${fields.area}-${fields.title ?? ''}`;
    const r = buildListing(fields, { id: 'import', label: sourceLabel }, seed);
    if (!r.listing) errors.push({ row: rowNo, message: `必須項目がありません: ${r.missing.join('、')}` });
    else {
      listings.push(r.listing);
      for (const w of r.warnings) warnings.push({ row: rowNo, message: w });
    }
  });
  return { listings, errors, warnings, headers };
}
