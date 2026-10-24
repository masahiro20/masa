import type {
  CriterionKey,
  EvaluatedListing,
  HazardLayerKey,
  Importance,
  Listing,
  ListingInsight,
  SearchConditions,
  SearchResponse,
  ZoningGroup,
} from '../shared/types';

export interface Meta {
  prefectures: string[];
  cities: Record<string, string[]>;
  sources: { id: string; label: string; description: string; enabled: boolean }[];
  criteria: Record<CriterionKey, string>;
  defaultImportance: Record<CriterionKey, Importance>;
  zoningGroups: Record<ZoningGroup, string>;
  hazardLayers: { key: HazardLayerKey; label: string; url: string }[];
  aiAvailable: boolean;
  aiModel?: string;
}

export interface PortalLink { portal: string; label: string; url: string; scope: string }

export type SearchResult = SearchResponse & { hazardPending: boolean; portalLinks: PortalLink[] };
export type InsightResult = ListingInsight & { evaluated: EvaluatedListing };
export interface AiProposal { markdown: string; sources: { title: string; url: string }[]; model: string }
export interface ImportPreview { listing?: Listing; missing: string[]; warnings: string[]; pairs: number }
export interface CsvResult {
  imported: number;
  geocoded: number;
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
  headers: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `通信エラー (${res.status})`);
  return body as T;
}

const post = <T>(url: string, data: unknown) =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  meta: () => request<Meta>('/api/meta'),
  search: (conditions: SearchConditions) => post<SearchResult>('/api/search', conditions),
  insight: (id: string, conditions: SearchConditions) => post<InsightResult>('/api/insight', { id, conditions }),
  aiProposal: (id: string, conditions: SearchConditions) => post<AiProposal>('/api/ai-proposal', { id, conditions }),
  importUrl: (url: string) => post<ImportPreview>('/api/import/url', { url }),
  saveListing: (listing: Listing) => post<{ listing: Listing }>('/api/imported', { listing }),
  importCsv: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<CsvResult>('/api/import/csv', { method: 'POST', body: fd });
  },
  imported: () => request<{ listings: Listing[] }>('/api/imported'),
  removeImported: (id: string) => request<{ removed: boolean }>(`/api/imported/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
