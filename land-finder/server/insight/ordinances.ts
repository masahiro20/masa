// 都道府県・政令市の建築関係条例のうち、戸建て計画で頻出する論点（がけ条例・路地状敷地・角敷地など）。
// 条例は改正されるため、内容は「確認すべき論点」として提示し、必ず特定行政庁で最新条文を確認する前提とする。
import type { Listing, RegulationItem } from '../../shared/types';

interface OrdinanceRule {
  /** 対象となる都道府県 */
  prefecture: string;
  /** 市区町村の前方一致（政令市・特定行政庁の独自条例） */
  cityPrefix?: string;
  name: string;
  items: (l: Listing) => RegulationItem[];
}

const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

const isSlope = (l: Listing) => l.terrain != null && l.terrain !== '平坦';
const isFlag = (l: Listing) => l.shape === '旗竿地';
const isCorner = (l: Listing) => l.roads.length >= 2;

const RULES: OrdinanceRule[] = [
  {
    prefecture: '東京都',
    name: '東京都建築安全条例',
    items: (l) => {
      const out: RegulationItem[] = [];
      if (isFlag(l)) {
        out.push({
          category: '条例',
          title: '路地状敷地の通路幅（東京都建築安全条例 第3条）',
          detail:
            '路地状部分の長さ20m以下は幅2m以上、20m超は3m以上が必要（延べ面積200㎡超の建築物は各3m・4m以上）。路地状敷地では3階建てや共同住宅などに追加制限があるため、計画規模を早めに確認してください。',
          severity: 'warning',
          basis: '東京都建築安全条例',
          needsCheck: true,
          link: search('東京都建築安全条例 第3条 路地状敷地'),
        });
      }
      if (isCorner(l)) {
        out.push({
          category: '条例',
          title: '角敷地のすみ切り（東京都建築安全条例 第2条）',
          detail:
            '幅員6m未満の道路が交わる角敷地（内角120度未満）では、角を頂点とする底辺2mの二等辺三角形部分を道路状に整備する必要があり、そこに建築物・門・塀は設けられません。外構計画に影響します。',
          severity: 'caution',
          basis: '東京都建築安全条例',
          needsCheck: true,
        });
      }
      if (isSlope(l)) {
        out.push({
          category: '条例',
          title: 'がけ条例（東京都建築安全条例 第6条）',
          detail:
            '高さ2mを超えるがけの下端（またはがけ上）から、がけ高さの2倍以内に建築する場合は、安全な擁壁の設置や基礎の深基礎化などが必要です。既存擁壁の検査済証の有無を確認してください。',
          severity: 'warning',
          basis: '東京都建築安全条例',
          needsCheck: true,
          link: search('東京都建築安全条例 第6条 がけ'),
        });
      }
      return out;
    },
  },
  {
    prefecture: '神奈川県',
    cityPrefix: '横浜市',
    name: '横浜市建築基準条例',
    items: (l) =>
      [
        isSlope(l) && {
          category: '条例' as const,
          title: 'がけ条例（横浜市建築基準条例 第3条）',
          detail:
            '高さ3mを超えるがけに近接する場合、がけ高さの2倍の範囲内では擁壁の設置・深基礎・RC造の外壁などの安全措置が求められます。横浜市は斜面地が多く、既存擁壁の安全性確認が重要です。',
          severity: 'warning' as const,
          basis: '横浜市建築基準条例',
          needsCheck: true,
          link: search('横浜市建築基準条例 がけ 第3条'),
        },
        isFlag(l) && {
          category: '条例' as const,
          title: '路地状敷地（横浜市建築基準条例）',
          detail: '路地状部分の長さに応じて必要な幅員が定められています。通路幅・長さを実測で確認してください。',
          severity: 'caution' as const,
          basis: '横浜市建築基準条例',
          needsCheck: true,
        },
      ].filter(Boolean) as RegulationItem[],
  },
  {
    prefecture: '神奈川県',
    name: '神奈川県建築基準条例',
    items: (l) =>
      [
        isSlope(l) && {
          category: '条例' as const,
          title: 'がけ条例（神奈川県建築基準条例）',
          detail:
            '高さ3mを超えるがけの近くに建築する場合、がけ高さの2倍以内の範囲で擁壁設置等の安全措置が必要です（川崎市・相模原市など独自条例を持つ市もあります）。',
          severity: 'warning' as const,
          basis: '神奈川県建築基準条例 ほか市条例',
          needsCheck: true,
          link: search(`${l.city} 建築基準条例 がけ`),
        },
        isFlag(l) && {
          category: '条例' as const,
          title: '路地状敷地',
          detail: '路地状部分の長さに応じた幅員の規定があります。特定行政庁の条例で確認してください。',
          severity: 'caution' as const,
          basis: '神奈川県建築基準条例 ほか',
          needsCheck: true,
        },
      ].filter(Boolean) as RegulationItem[],
  },
];

/** 条例が個別登録されていない地域の汎用論点 */
function genericItems(l: Listing): RegulationItem[] {
  const out: RegulationItem[] = [];
  if (isSlope(l)) {
    out.push({
      category: '条例',
      title: `がけ条例（${l.prefecture}・${l.city}）`,
      detail:
        '多くの自治体で、一定高さ（概ね2〜3m）を超えるがけの近くでは擁壁の設置や建築位置の制限があります。特定行政庁の条例で数値を確認してください。',
      severity: 'warning',
      needsCheck: true,
      link: search(`${l.prefecture} 建築基準法施行条例 がけ`),
    });
  }
  if (isFlag(l)) {
    out.push({
      category: '条例',
      title: '路地状敷地（旗竿地）の通路幅',
      detail: '通路部分の長さに応じた最低幅員が条例で定められている場合があります。',
      severity: 'caution',
      needsCheck: true,
      link: search(`${l.prefecture} 建築条例 路地状敷地`),
    });
  }
  return out;
}

export function ordinanceItems(l: Listing): RegulationItem[] {
  const matched = RULES.filter(
    (r) => r.prefecture === l.prefecture && (!r.cityPrefix || l.city.startsWith(r.cityPrefix)),
  );
  // 政令市の条例がある場合は県条例より優先
  const specific = matched.find((r) => r.cityPrefix) ?? matched[0];
  const items = specific ? specific.items(l) : genericItems(l);

  items.push({
    category: '条例',
    title: 'まちづくり・開発関連の条例',
    detail: `${l.city}の中高層建築物紛争予防条例、雨水流出抑制（浸透施設の設置）、緑化・みどりの条例、ワンルーム・開発指導要綱などは自治体ごとに異なります。敷地規模によっては事前協議が必要です。`,
    severity: 'info',
    needsCheck: true,
    link: search(`${l.city} 建築 条例 戸建て 雨水浸透 緑化`),
  });
  return items;
}
