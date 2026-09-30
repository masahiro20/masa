// ポータルサイトの物件ページやCSVに現れる表記ゆれを吸収して数値・構造に変換するパーサー群。
import type { CityPlanning, Direction, FireZone, RoadAccess, StationAccess } from '../../shared/types';
import { tsuboToSqm } from '../../shared/units';

/** 全角英数・記号を半角にする */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\u3000\u00a0]/g, ' ')
    .trim();
}

/** 半角化に加えて桁区切りのカンマを除去する（数値の読み取り用） */
export function normalizeText(s: string): string {
  return toHalfWidth(s).replace(/(\d),(?=\d{3})/g, '$1');
}

const num = (s: string) => Number.parseFloat(s);

/**
 * 価格を万円で返す。「8489万円～1億247万円」のような範囲は下限を返す。
 * 「1億2000万円」「3280万円」「32,800,000円」「3280」に対応。
 */
export function parsePrice(raw?: string): number | undefined {
  if (!raw) return undefined;
  const s = normalizeText(raw).split(/[～~〜-]/)[0];
  const oku = s.match(/(\d+(?:\.\d+)?)\s*億/);
  const man = s.match(/(\d+(?:\.\d+)?)\s*万/);
  if (oku || man) return (oku ? num(oku[1]) * 10000 : 0) + (man ? num(man[1]) : 0);
  const yen = s.match(/(\d+(?:\.\d+)?)\s*円/);
  if (yen) return num(yen[1]) / 10000;
  const plain = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  return plain ? num(plain[1]) : undefined;
}

/** 面積を㎡で返す。「106.84m2（32.31坪）」「120.5㎡」「32坪」に対応 */
export function parseArea(raw?: string): number | undefined {
  if (!raw) return undefined;
  const s = normalizeText(raw).split(/[～~〜]/)[0];
  const sqm = s.match(/(\d+(?:\.\d+)?)\s*(?:m2|m²|㎡|平米|平方メートル)/i);
  if (sqm) return num(sqm[1]);
  const tsubo = s.match(/(\d+(?:\.\d+)?)\s*坪/);
  if (tsubo) return Math.round(tsuboToSqm(num(tsubo[1])) * 100) / 100;
  const plain = s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  return plain ? num(plain[1]) : undefined;
}

/** 「建ぺい率：40％、容積率：80％」「60%/200%」 */
export function parseRatios(raw?: string): { coverageRatio?: number; floorAreaRatio?: number } {
  if (!raw) return {};
  const s = normalizeText(raw);
  const cov = s.match(/建[ぺペ]い率\D*?(\d+(?:\.\d+)?)/);
  const far = s.match(/容積率\D*?(\d+(?:\.\d+)?)/);
  if (cov || far) return { coverageRatio: cov ? num(cov[1]) : undefined, floorAreaRatio: far ? num(far[1]) : undefined };
  const pair = s.match(/(\d+(?:\.\d+)?)\s*%?\s*[/／・,]\s*(\d+(?:\.\d+)?)/);
  if (pair) return { coverageRatio: num(pair[1]), floorAreaRatio: num(pair[2]) };
  return {};
}

export function parsePercent(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = normalizeText(raw).match(/(\d+(?:\.\d+)?)/);
  return m ? num(m[1]) : undefined;
}

const DIRECTIONS: Direction[] = ['北東', '北西', '南東', '南西', '北', '東', '南', '西'];

/**
 * 接道情報を分解する。
 * 例: 「北西側5.8m 公道」「南側 公道 幅員4.0m 接面6.2m」「東側4m、南側6m（角地）」「42条2項道路」
 */
export function parseRoads(raw?: string): RoadAccess[] {
  if (!raw) return [];
  const s = normalizeText(raw);
  const roads: RoadAccess[] = [];
  const dirRe = /(北東|北西|南東|南西|北|東|南|西)\s*側?/g;
  const hits = [...s.matchAll(dirRe)];
  const segments =
    hits.length > 0
      ? hits.map((h, i) => ({ dir: h[1] as Direction, text: s.slice(h.index!, hits[i + 1]?.index ?? s.length) }))
      : [{ dir: undefined, text: s }];

  for (const seg of segments) {
    const t = seg.text;
    const width = t.match(/(?:幅員|道路幅)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*m(?!2)/i);
    const frontage = t.match(/(?:接面|間口|接道|接道長さ)\D{0,4}(\d+(?:\.\d+)?)\s*m/i);
    const kind = /私道/.test(t) ? '私道' : /公道|市道|区道|町道|村道|県道|都道|府道|道道|国道/.test(t) ? '公道' : undefined;
    const article = t.match(/42条\s*(\d項(?:\d号)?)/);
    const road: RoadAccess = {
      direction: seg.dir,
      width: width ? num(width[1]) : undefined,
      frontage: frontage ? num(frontage[1]) : undefined,
      kind,
      article: article ? `42条${article[1]}` : undefined,
    };
    if (road.direction || road.width || road.kind || road.article) roads.push(road);
  }

  // 方位なしで「道路幅：5.8m」のみ記載 → 方位付きの道路に幅員を補完する
  const bareWidth = s.match(/道路幅\s*[:：]?\s*(\d+(?:\.\d+)?)\s*m/i);
  if (bareWidth) for (const r of roads) r.width ??= num(bareWidth[1]);
  // 同じ方位の重複を除く
  const seen = new Set<string>();
  return roads.filter((r) => {
    const key = `${r.direction ?? ''}-${r.width ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseDirection(raw?: string): Direction | undefined {
  if (!raw) return undefined;
  return DIRECTIONS.find((d) => raw.includes(d));
}

/**
 * 交通表記を分解する。
 * 例: 東急田園都市線「二子玉川」バス11分岡本三丁目歩3分 東急田園都市線「用賀」歩24分
 */
export function parseStations(raw?: string): StationAccess[] {
  if (!raw) return [];
  const s = normalizeText(raw).replace(/\[[^\]]*\]/g, ' ');
  const out: StationAccess[] = [];
  const re = /([^\s「」『』、/]*?)[「『]([^」』]+)[」』]\s*(?:駅)?\s*((?:バス\s*\d+\s*分)?[^「『]*?)(?:(?:徒)?歩\s*(\d+)\s*分)/g;
  for (const m of s.matchAll(re)) {
    const bus = m[3].match(/バス\s*(\d+)\s*分/);
    out.push({
      line: m[1] || undefined,
      name: m[2],
      bus: bus ? Number(bus[1]) : undefined,
      walk: Number(m[4]),
    });
  }
  if (out.length > 0) return out;
  // 「○○駅 徒歩8分」形式
  for (const m of s.matchAll(/([^\s、/]+?)駅\s*(?:より|から)?\s*(?:徒歩|歩)\s*(\d+)\s*分/g)) {
    out.push({ name: m[1], walk: Number(m[2]) });
  }
  return out;
}

export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

const DESIGNATED_CITIES = [
  '札幌市', '仙台市', 'さいたま市', '千葉市', '横浜市', '川崎市', '相模原市', '新潟市', '静岡市', '浜松市',
  '名古屋市', '京都市', '大阪市', '堺市', '神戸市', '岡山市', '広島市', '北九州市', '福岡市', '熊本市',
];

/** 住所を都道府県・市区町村・それ以降に分ける（政令指定都市は「横浜市青葉区」までを市区町村とする） */
export function splitAddress(raw?: string): { prefecture?: string; city?: string; rest?: string } {
  if (!raw) return {};
  let s = normalizeText(raw).replace(/\s+/g, '');
  const prefecture = PREFECTURES.find((p) => s.startsWith(p));
  if (prefecture) s = s.slice(prefecture.length);
  const designated = DESIGNATED_CITIES.find((c) => s.startsWith(c));
  let city: string | undefined;
  if (designated) {
    const ward = s.slice(designated.length).match(/^(.+?区)/);
    city = designated + (ward ? ward[1] : '');
  } else {
    const m = s.match(/^(.+?郡.+?[町村])/) ?? s.match(/^(.+?[市区町村])/);
    city = m?.[1];
  }
  const rest = city ? s.slice(city.length) : s;
  return { prefecture, city, rest: rest || undefined };
}

export function parseCityPlanning(raw?: string): CityPlanning | undefined {
  if (!raw) return undefined;
  if (raw.includes('調整')) return '市街化調整区域';
  if (raw.includes('非線引')) return '非線引き区域';
  if (raw.includes('区域外')) return '都市計画区域外';
  if (raw.includes('市街化区域')) return '市街化区域';
  return undefined;
}

export function parseFireZone(raw?: string): FireZone | undefined {
  if (!raw) return undefined;
  if (raw.includes('準防火')) return '準防火地域';
  if (raw.includes('防火地域')) return '防火地域';
  if (/22条|法22/.test(normalizeText(raw))) return '法22条区域';
  if (/指定なし|無指定/.test(raw)) return '指定なし';
  return undefined;
}

/** 建築条件: 付/有 → true, なし/無 → false */
export function parseBuildingCondition(raw?: string): boolean | undefined {
  if (!raw) return undefined;
  if (/無し|なし|無|不要/.test(raw)) return false;
  if (/付|有|あり/.test(raw)) return true;
  return undefined;
}

export function parseShape(raw?: string): '整形地' | '不整形地' | '旗竿地' | undefined {
  if (!raw) return undefined;
  if (/旗竿|路地状|敷地延長/.test(raw)) return '旗竿地';
  if (/不整形|台形|三角/.test(raw)) return '不整形地';
  if (/整形|長方形|正方形|矩形/.test(raw)) return '整形地';
  return undefined;
}

export function parseTerrain(raw?: string): '平坦' | '高低差あり' | '傾斜地' | 'ひな壇' | undefined {
  if (!raw) return undefined;
  if (/ひな壇/.test(raw)) return 'ひな壇';
  if (/傾斜|法地|崖|がけ/.test(raw)) return '傾斜地';
  if (/高低差|擁壁/.test(raw)) return '高低差あり';
  if (/平坦/.test(raw)) return '平坦';
  return undefined;
}

export function splitList(raw?: string): string[] {
  if (!raw) return [];
  return toHalfWidth(raw)
    .split(/[、,/\n]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '-' && s !== 'なし');
}
