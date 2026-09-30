import type { Listing, SearchConditions } from '../../shared/types';

/**
 * 物件の取得元アダプタ。
 * ポータルサイトや業者間の物件データ（API・CSV・データフィード）を追加する場合はこのインターフェースを実装し、
 * registry.ts に登録する。
 */
export interface SourceAdapter {
  id: string;
  label: string;
  description: string;
  /** false の場合は検索に使わない（契約・設定が必要なアダプタなど） */
  enabled: () => boolean;
  /** 条件で大まかに絞り込んだ物件を返す（詳細な評価は scoring.ts が行う） */
  search: (conditions: SearchConditions) => Promise<Listing[]>;
  /** 全件（相場比較や詳細表示で使う） */
  all: () => Promise<Listing[]>;
}
