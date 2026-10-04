// 主要ポータルサイトの土地検索ページへのリンクを組み立てる。
// 各サイトの利用規約は機械的な情報収集（スクレイピング）を制限しているため、自動巡回は行わず、
// 担当者が条件に合う検索ページをワンクリックで開けるようにする。
import type { AreaSelection } from '../../shared/types';

export const PREF_ROMAJI: Record<string, string> = {
  北海道: 'hokkaido', 青森県: 'aomori', 岩手県: 'iwate', 宮城県: 'miyagi', 秋田県: 'akita', 山形県: 'yamagata',
  福島県: 'fukushima', 茨城県: 'ibaraki', 栃木県: 'tochigi', 群馬県: 'gumma', 埼玉県: 'saitama', 千葉県: 'chiba',
  東京都: 'tokyo', 神奈川県: 'kanagawa', 新潟県: 'niigata', 富山県: 'toyama', 石川県: 'ishikawa', 福井県: 'fukui',
  山梨県: 'yamanashi', 長野県: 'nagano', 岐阜県: 'gifu', 静岡県: 'shizuoka', 愛知県: 'aichi', 三重県: 'mie',
  滋賀県: 'shiga', 京都府: 'kyoto', 大阪府: 'osaka', 兵庫県: 'hyogo', 奈良県: 'nara', 和歌山県: 'wakayama',
  鳥取県: 'tottori', 島根県: 'shimane', 岡山県: 'okayama', 広島県: 'hiroshima', 山口県: 'yamaguchi', 徳島県: 'tokushima',
  香川県: 'kagawa', 愛媛県: 'ehime', 高知県: 'kochi', 福岡県: 'fukuoka', 佐賀県: 'saga', 長崎県: 'nagasaki',
  熊本県: 'kumamoto', 大分県: 'oita', 宮崎県: 'miyazaki', 鹿児島県: 'kagoshima', 沖縄県: 'okinawa',
};

/** SUUMOの市区町村スラッグ（動作確認済みのもの）。未登録の市区町村は都道府県ページにフォールバック */
const SUUMO_CITY: Record<string, string> = {
  世田谷区: 'setagaya', 杉並区: 'suginami', 練馬区: 'nerima', 町田市: 'machida', 八王子市: 'hachioji',
  江戸川区: 'edogawa', 府中市: 'fuchu', 横浜市青葉区: 'yokohamashiaoba', 横浜市港北区: 'yokohamashikohoku',
  川崎市宮前区: 'kawasakishimiyamae', 藤沢市: 'fujisawa', 鎌倉市: 'kamakura', さいたま市浦和区: 'saitamashiurawa',
  川口市: 'kawaguchi', 越谷市: 'koshigaya', 所沢市: 'tokorozawa', 船橋市: 'funabashi', 柏市: 'kashiwa', 浦安市: 'urayasu',
};

export interface PortalLink {
  portal: 'SUUMO' | "LIFULL HOME'S" | '不動産ジャパン';
  label: string;
  url: string;
  scope: '市区町村' | '都道府県' | '全国';
}

export function portalLinks(areas: AreaSelection[]): PortalLink[] {
  const links: PortalLink[] = [];
  const targets = areas.length ? areas : [];
  for (const a of targets) {
    const pref = PREF_ROMAJI[a.prefecture];
    if (!pref) continue;
    const city = a.city ? SUUMO_CITY[a.city] : undefined;
    const name = `${a.prefecture}${a.city ?? ''}`;
    links.push({
      portal: 'SUUMO',
      label: `${name}の土地`,
      url: city ? `https://suumo.jp/tochi/${pref}/sc_${city}/` : `https://suumo.jp/tochi/${pref}/`,
      scope: city ? '市区町村' : '都道府県',
    });
    links.push({
      portal: "LIFULL HOME'S",
      label: `${a.prefecture}の土地`,
      url: `https://www.homes.co.jp/tochi/${pref}/`,
      scope: '都道府県',
    });
  }
  links.push({
    portal: '不動産ジャパン',
    label: '土地を探す（都道府県選択）',
    url: 'https://www.fudousan.or.jp/property/buy/pref?ptm[]=0101',
    scope: '全国',
  });
  // 同じURLは1つにまとめる
  return links.filter((l, i) => links.findIndex((x) => x.url === l.url) === i);
}
