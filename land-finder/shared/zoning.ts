import type { ZoningGroup } from './types';

export interface ZoningInfo {
  name: string;
  short: string;
  group: ZoningGroup;
  /** 住居系か（前面道路幅員による容積率制限の係数 0.4 / 0.6 の判定に使う） */
  residential: boolean;
  character: string;
}

// 都市計画法の13用途地域
export const ZONINGS: ZoningInfo[] = [
  {
    name: '第一種低層住居専用地域',
    short: '一低層',
    group: 'lowRise',
    residential: true,
    character: '低層住宅のための地域。店舗は小規模な兼用住宅程度に限られ、閑静な住宅街が形成されやすい。',
  },
  {
    name: '第二種低層住居専用地域',
    short: '二低層',
    group: 'lowRise',
    residential: true,
    character: '低層住宅が中心。150㎡以下の小規模店舗が立地でき、落ち着いた住環境に日常の買い物施設が混在する。',
  },
  {
    name: '田園住居地域',
    short: '田園住居',
    group: 'lowRise',
    residential: true,
    character: '農地と調和した低層住宅地。農地の開発には許可が必要で、ゆとりある環境が保たれやすい。',
  },
  {
    name: '第一種中高層住居専用地域',
    short: '一中高',
    group: 'midRise',
    residential: true,
    character: '中高層住宅（マンション）と戸建てが混在。500㎡以下の店舗や病院・大学も立地できる。',
  },
  {
    name: '第二種中高層住居専用地域',
    short: '二中高',
    group: 'midRise',
    residential: true,
    character: '中高層住宅が中心で、1,500㎡以下の店舗・事務所も可能。利便性と住環境のバランス型。',
  },
  {
    name: '第一種住居地域',
    short: '一住居',
    group: 'residential',
    residential: true,
    character: '住居の環境を守る地域。3,000㎡以下の店舗・事務所・ホテル等も立地でき、幹線道路沿いに多い。',
  },
  {
    name: '第二種住居地域',
    short: '二住居',
    group: 'residential',
    residential: true,
    character: '住宅に加えパチンコ店・カラオケ等も立地可能。利便性は高いが周辺用途の変化に注意。',
  },
  {
    name: '準住居地域',
    short: '準住居',
    group: 'residential',
    residential: true,
    character: '幹線道路沿いで自動車関連施設と住宅が調和する地域。交通量・騒音に配慮が必要。',
  },
  {
    name: '近隣商業地域',
    short: '近商',
    group: 'commercial',
    residential: false,
    character: '近隣住民の買い物のための地域。駅前商店街などに多く、利便性が高い一方で日照・静けさは劣りやすい。',
  },
  {
    name: '商業地域',
    short: '商業',
    group: 'commercial',
    residential: false,
    character: '銀行・映画館・百貨店などが集まる地域。高容積で高層建物が建ちやすく、戸建ての日照は期待しにくい。',
  },
  {
    name: '準工業地域',
    short: '準工',
    group: 'industrial',
    residential: false,
    character: '環境悪化の少ない工場と住宅が混在。周辺に工場・倉庫が建つ可能性がある。',
  },
  {
    name: '工業地域',
    short: '工業',
    group: 'industrial',
    residential: false,
    character: '工業の業務の利便を図る地域。住宅は建築できるが、学校・病院等は不可で住環境としては慎重な検討が必要。',
  },
  {
    name: '工業専用地域',
    short: '工専',
    group: 'industrial',
    residential: false,
    character: '工業専用。住宅は建築できない。',
  },
];

export const ZONING_GROUP_LABELS: Record<ZoningGroup, string> = {
  lowRise: '低層住居系（一低層・二低層・田園住居）',
  midRise: '中高層住居系（一中高・二中高）',
  residential: '住居系（一住居・二住居・準住居）',
  commercial: '商業系（近商・商業）',
  industrial: '工業系（準工・工業）',
};

const toHalfWidth = (s: string) =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '');

/** 「１種低層」「一低層」「第1種中高層住居専用地域」などの表記ゆれを正式名称に正規化する */
export function normalizeZoning(raw?: string): ZoningInfo | undefined {
  if (!raw) return undefined;
  const s = toHalfWidth(raw).replace(/第/g, '').replace(/1/g, '一').replace(/2/g, '二');
  if (s.includes('田園')) return byName('田園住居地域');
  if (s.includes('工業専用') || s.includes('工専')) return byName('工業専用地域');
  if (s.includes('準工')) return byName('準工業地域');
  if (s.includes('工業')) return byName('工業地域');
  if (s.includes('近隣商業') || s.includes('近商')) return byName('近隣商業地域');
  if (s.includes('商業')) return byName('商業地域');
  if (s.includes('準住居')) return byName('準住居地域');
  const isFirst = s.includes('一種') || /^一/.test(s);
  const isSecond = s.includes('二種') || /^二/.test(s);
  if (s.includes('低層')) return byName(isSecond ? '第二種低層住居専用地域' : '第一種低層住居専用地域');
  if (s.includes('中高')) return byName(isSecond ? '第二種中高層住居専用地域' : '第一種中高層住居専用地域');
  if (s.includes('住居')) {
    if (isSecond) return byName('第二種住居地域');
    if (isFirst) return byName('第一種住居地域');
  }
  return ZONINGS.find((z) => s.includes(z.name));
}

function byName(name: string) {
  return ZONINGS.find((z) => z.name === name);
}
