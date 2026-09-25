// 物件の法令上の条件から、戸建て住宅の設計で注意すべき点と建築可能ボリュームの概算を導く。
// 建築基準法・都市計画法などの一般則に基づく目安であり、最終判断は建築士・特定行政庁で行う前提。
import type { Listing, RegulationItem, RegulationReport, VolumeEstimate } from '../../shared/types';
import { round, sqmToTsubo } from '../../shared/units';
import { normalizeZoning } from '../../shared/zoning';
import { ordinanceItems } from './ordinances';

const LOW_RISE = ['第一種低層住居専用地域', '第二種低層住居専用地域', '田園住居地域'];
const MID_RISE = ['第一種中高層住居専用地域', '第二種中高層住居専用地域'];

/** 42条2項道路などで必要な中心後退距離 (m) */
export function setbackDepth(width?: number, article?: string): number {
  const narrow = width != null && width < 4;
  if (!narrow && !article?.includes('2項')) return 0;
  if (width == null) return 0;
  return round(Math.max(0, (4 - width) / 2), 2);
}

export function estimateVolume(l: Listing): VolumeEstimate {
  const zoning = normalizeZoning(l.zoning);
  const notes: string[] = [];

  let setbackArea = 0;
  for (const r of l.roads) {
    const depth = setbackDepth(r.width, r.article);
    if (depth > 0) {
      if (r.frontage) {
        setbackArea += depth * r.frontage;
        notes.push(`${r.direction ?? ''}側道路：中心から2m後退（約${depth}m×間口${r.frontage}m）`);
      } else {
        notes.push(`${r.direction ?? ''}側道路：約${depth}mのセットバックが必要（間口不明のため面積は未控除）`);
      }
    }
  }
  setbackArea = round(setbackArea, 2);
  const effectiveArea = round(Math.max(0, l.landArea - setbackArea), 2);

  // 前面道路幅員による容積率制限（幅員12m未満）
  const widths = l.roads.map((r) => r.width).filter((w): w is number => w != null);
  const roadWidth = widths.length ? Math.max(...widths) : undefined;
  let roadLimitedFAR: number | undefined;
  if (roadWidth != null && roadWidth < 12) {
    const factor = zoning ? (zoning.residential ? 0.4 : 0.6) : 0.4;
    roadLimitedFAR = round(Math.max(roadWidth, 4) * factor * 100, 0);
  }
  const effectiveFAR =
    l.floorAreaRatio != null
      ? roadLimitedFAR != null
        ? Math.min(l.floorAreaRatio, roadLimitedFAR)
        : l.floorAreaRatio
      : undefined;
  if (effectiveFAR != null && l.floorAreaRatio != null && effectiveFAR < l.floorAreaRatio) {
    notes.push(
      `前面道路幅員${roadWidth}mにより容積率は${l.floorAreaRatio}%→${effectiveFAR}%に制限（${zoning?.residential === false ? '×0.6' : '×0.4'}）`,
    );
  }

  let coverageBonus = 0;
  if (l.roads.length >= 2) {
    coverageBonus += 10;
    notes.push('角地：特定行政庁の指定要件を満たせば建ぺい率+10%');
  }
  if (l.fireZone === '防火地域' || l.fireZone === '準防火地域') {
    notes.push(
      `${l.fireZone}：${l.fireZone === '防火地域' ? '耐火建築物' : '耐火・準耐火建築物'}等とすれば建ぺい率+10%（2019年改正）`,
    );
  }

  const maxBuildingArea = l.coverageRatio != null ? round((effectiveArea * l.coverageRatio) / 100, 2) : undefined;
  const maxFloorArea = effectiveFAR != null ? round((effectiveArea * effectiveFAR) / 100, 2) : undefined;
  if (maxFloorArea != null && maxBuildingArea != null && zoning && LOW_RISE.includes(zoning.name)) {
    notes.push(`低層住居系のため実質2階建てが中心。2階建てなら延床は最大で約${round(Math.min(maxFloorArea, maxBuildingArea * 2), 1)}㎡`);
  }

  return {
    siteArea: l.landArea,
    setbackArea,
    effectiveArea,
    coverageRatio: l.coverageRatio,
    coverageBonus,
    floorAreaRatio: l.floorAreaRatio,
    roadLimitedFAR,
    effectiveFAR,
    maxBuildingArea,
    maxFloorArea,
    notes,
  };
}

const KEYWORD_RULES: { re: RegExp; item: RegulationItem }[] = [
  {
    re: /風致地区/,
    item: {
      category: 'その他',
      title: '風致地区',
      detail:
        '建築・宅地造成・木竹の伐採等に許可が必要です。建ぺい率・高さ・外壁後退・緑化率が一般の用途地域より厳しく定められていることが多く、プランへの影響が大きい規制です。',
      severity: 'warning',
      basis: '都市計画法・風致地区条例',
      needsCheck: true,
    },
  },
  {
    re: /地区計画/,
    item: {
      category: 'その他',
      title: '地区計画',
      detail:
        '建物の用途・高さ・壁面の位置・垣柵の構造・最低敷地面積などが地区ごとに定められている場合があります。着工の30日前までに届出が必要です。',
      severity: 'caution',
      basis: '都市計画法 第58条の2',
      needsCheck: true,
    },
  },
  {
    re: /建築協定/,
    item: {
      category: 'その他',
      title: '建築協定',
      detail: '住民間の協定で、用途・形態・意匠などが制限されます。協定書の内容（階数・外壁後退・色彩など）を入手してください。',
      severity: 'caution',
      basis: '建築基準法 第69条',
      needsCheck: true,
    },
  },
  {
    re: /景観/,
    item: {
      category: 'その他',
      title: '景観計画区域・景観地区',
      detail: '外観の色彩・屋根形状・高さなどに基準があり、一定規模以上は届出・認定が必要です。',
      severity: 'info',
      basis: '景観法',
      needsCheck: true,
    },
  },
  {
    re: /埋蔵文化財|包蔵地/,
    item: {
      category: '土地・造成',
      title: '周知の埋蔵文化財包蔵地',
      detail:
        '土木工事の60日前までに届出が必要で、試掘・本発掘調査となると工期が数か月延び、費用負担が生じる場合があります。',
      severity: 'warning',
      basis: '文化財保護法 第93条',
      needsCheck: true,
    },
  },
  {
    re: /宅地造成|盛土/,
    item: {
      category: '土地・造成',
      title: '宅地造成等工事規制区域（盛土規制法）',
      detail:
        '一定規模を超える盛土・切土（例：高さ1m超のがけを生じる盛土、2m超のがけを生じる切土など）は許可が必要です。擁壁の新設・造り替えを伴う場合は費用と工期に注意。',
      severity: 'caution',
      basis: '宅地造成及び特定盛土等規制法',
      needsCheck: true,
    },
  },
  {
    re: /土砂災害/,
    item: {
      category: '土地・造成',
      title: '土砂災害警戒区域等の指定',
      detail: '特別警戒区域の場合は居室を有する建築物に構造規制があります。ハザードタブの判定結果と合わせて確認してください。',
      severity: 'warning',
      basis: '土砂災害防止法',
      needsCheck: true,
    },
  },
  {
    re: /日影/,
    item: {
      category: '高さ・斜線',
      title: '日影規制',
      detail: '一定の高さを超える建築物は、冬至日に隣地へ落とす日影の時間が制限されます（低層住居系では軒高7m超または3階建て以上が対象）。',
      severity: 'info',
      basis: '建築基準法 第56条の2',
    },
  },
  {
    re: /緑化/,
    item: {
      category: 'その他',
      title: '緑化地域・緑化率',
      detail: '敷地面積が一定以上の場合、緑化率の最低限度が定められていることがあります。外構計画と費用に反映してください。',
      severity: 'info',
      basis: '都市緑地法',
      needsCheck: true,
    },
  },
  {
    re: /敷地面積[^、,]*最低限度|最低敷地/,
    item: {
      category: '用途地域',
      title: '敷地面積の最低限度',
      detail: '最低敷地面積を下回る分割はできません。将来の分筆・売却時にも影響します。',
      severity: 'caution',
      basis: '建築基準法 第53条の2',
      needsCheck: true,
    },
  },
];

export function buildRegulations(l: Listing): RegulationReport {
  const items: RegulationItem[] = [];
  const zoning = normalizeZoning(l.zoning);
  const volume = estimateVolume(l);

  // 都市計画
  if (l.cityPlanning === '市街化調整区域') {
    items.push({
      category: '用途地域',
      title: '市街化調整区域',
      detail:
        '原則として住宅の新築はできません。開発許可・建築許可（既存宅地、分家住宅、条例による区域指定など）の要件を満たす必要があり、住宅ローン審査にも影響します。',
      severity: 'warning',
      basis: '都市計画法 第29条・第43条',
    });
  } else if (l.cityPlanning === '非線引き区域' || l.cityPlanning === '都市計画区域外') {
    items.push({
      category: '用途地域',
      title: l.cityPlanning,
      detail: '用途地域が指定されていない場合、建ぺい率・容積率は特定行政庁が定める数値となります。上下水道等のインフラ整備状況も確認してください。',
      severity: 'caution',
    });
  }

  // 用途地域
  if (zoning) {
    items.push({ category: '用途地域', title: zoning.name, detail: zoning.character, severity: 'info', basis: '都市計画法 第9条' });
    if (LOW_RISE.includes(zoning.name)) {
      items.push({
        category: '高さ・斜線',
        title: '絶対高さ制限（10mまたは12m）',
        detail:
          '建物の高さは都市計画で定める10mまたは12mが上限です。北側斜線（隣地境界で5m＋1.25/1）もかかるため、3階建てや勾配屋根の計画では北側の形状に影響します。外壁後退（1m・1.5m）や敷地面積の最低限度が定められていることもあります。',
        severity: 'caution',
        basis: '建築基準法 第55条・第56条',
      });
    } else if (MID_RISE.includes(zoning.name)) {
      items.push({
        category: '高さ・斜線',
        title: '北側斜線・道路斜線',
        detail: '北側斜線（10m＋1.25/1）と道路斜線（1.25/1）がかかります。日影規制の対象となる高さ（10m超）にも注意。',
        severity: 'info',
        basis: '建築基準法 第56条',
      });
    } else if (zoning.group === 'industrial' && zoning.name === '工業専用地域') {
      items.push({ category: '用途地域', title: '住宅は建築不可', detail: '工業専用地域では住宅を建築できません。', severity: 'warning', basis: '建築基準法 別表第二' });
    } else {
      items.push({
        category: '高さ・斜線',
        title: '道路斜線・隣地斜線',
        detail: `道路斜線（${zoning.residential ? '1.25' : '1.5'}/1）と隣地斜線がかかります。周辺に中高層建物が建つ可能性があり、日照・眺望は将来変わり得ます。`,
        severity: 'info',
        basis: '建築基準法 第56条',
      });
    }
  } else {
    items.push({ category: '用途地域', title: '用途地域が不明', detail: '都市計画図（自治体の都市計画情報）で用途地域・高度地区・防火指定を確認してください。', severity: 'caution' });
  }

  if (l.heightDistrict) {
    items.push({
      category: '高さ・斜線',
      title: `高度地区（${l.heightDistrict}）`,
      detail: '北側の高さ制限が北側斜線より厳しく設定されています（東京都の第一種高度地区は5m＋0.6/1など）。屋根形状・3階建ての可否に影響します。',
      severity: 'caution',
      needsCheck: true,
    });
  }

  // 建ぺい率・容積率
  if (l.coverageRatio != null || l.floorAreaRatio != null) {
    items.push({
      category: '建ぺい率・容積率',
      title: `建ぺい率${l.coverageRatio ?? '-'}% / 容積率${l.floorAreaRatio ?? '-'}%`,
      detail: [
        volume.maxBuildingArea != null ? `建築面積の上限 約${volume.maxBuildingArea}㎡（${round(sqmToTsubo(volume.maxBuildingArea), 1)}坪）` : null,
        volume.maxFloorArea != null ? `延床面積の上限 約${volume.maxFloorArea}㎡（${round(sqmToTsubo(volume.maxFloorArea), 1)}坪）` : null,
        ...volume.notes,
      ]
        .filter(Boolean)
        .join('。'),
      severity: volume.effectiveFAR != null && l.floorAreaRatio != null && volume.effectiveFAR < l.floorAreaRatio ? 'caution' : 'info',
      basis: '建築基準法 第52条・第53条',
    });
  }

  // 防火
  if (l.fireZone === '防火地域') {
    items.push({
      category: '防火',
      title: '防火地域',
      detail: '階数3以上または延べ面積100㎡超は耐火建築物、それ以外も準耐火建築物等が必要です。木造の場合は耐火仕様となり、建築費が上がりやすい地域です。',
      severity: 'caution',
      basis: '建築基準法 第61条',
    });
  } else if (l.fireZone === '準防火地域') {
    items.push({
      category: '防火',
      title: '準防火地域',
      detail: '2階建て以下でも延焼のおそれのある部分の外壁・軒裏を防火構造、窓を防火設備（網入りガラス・防火サッシ等）にする必要があります。3階建ては準耐火建築物相当。サッシ費用の増額に注意。',
      severity: 'info',
      basis: '建築基準法 第61条',
    });
  } else if (l.fireZone === '法22条区域') {
    items.push({
      category: '防火',
      title: '法22条区域',
      detail: '屋根を不燃材料等とし、延焼のおそれのある部分の外壁を準防火性能とする必要があります。',
      severity: 'info',
      basis: '建築基準法 第22条・第23条',
    });
  }

  // 接道
  if (l.roads.length === 0) {
    items.push({ category: '接道', title: '接道状況が不明', detail: '建築基準法上の道路に2m以上接しているか（接道義務）を役所の道路台帳・指定道路図で確認してください。', severity: 'warning', basis: '建築基準法 第43条' });
  }
  for (const r of l.roads) {
    const dir = r.direction ? `${r.direction}側` : '';
    if (r.frontage != null && r.frontage < 2) {
      items.push({
        category: '接道',
        title: `${dir}接道長さ${r.frontage}m（接道義務未達のおそれ）`,
        detail: '建築基準法上の道路に2m以上接していないと原則として建築できません（再建築不可）。43条2項の許可・認定の可能性を確認してください。',
        severity: 'warning',
        basis: '建築基準法 第43条',
      });
    }
    const depth = setbackDepth(r.width, r.article);
    if (depth > 0 || r.article?.includes('2項')) {
      items.push({
        category: '接道',
        title: `${dir}道路のセットバック（42条2項道路）`,
        detail: `幅員${r.width ?? '不明'}mのため道路中心線から2m（約${depth || '?'}m）後退が必要です。後退部分は建ぺい率・容積率の敷地面積に算入できず、塀・門も設置できません。`,
        severity: 'caution',
        basis: '建築基準法 第42条2項',
      });
    }
    if (r.kind === '私道') {
      items.push({
        category: '接道',
        title: `${dir}私道に接道`,
        detail: '私道の持分の有無、通行・掘削承諾（上下水道・ガス引込み工事）の取得可否を確認してください。位置指定道路か否かも要確認。',
        severity: 'caution',
      });
    }
  }
  if (l.shape === '旗竿地') {
    items.push({
      category: '接道',
      title: '旗竿地（路地状敷地）',
      detail: '通路部分は駐車スペースとして使えることが多い一方、工事車両の進入・資材搬入費、採光・通風計画に注意が必要です。',
      severity: 'caution',
    });
  }

  // 土地・造成
  if (l.landCategory && /田|畑/.test(l.landCategory)) {
    items.push({
      category: '土地・造成',
      title: `地目「${l.landCategory}」（農地）`,
      detail: '宅地として利用するには農地転用の手続きが必要です（市街化区域内は届出、それ以外は許可）。地目変更登記も必要です。',
      severity: 'warning',
      basis: '農地法 第4条・第5条',
    });
  }
  if (l.terrain && l.terrain !== '平坦') {
    items.push({
      category: '土地・造成',
      title: `敷地の${l.terrain}`,
      detail: '擁壁の有無と検査済証、造成時期を確認してください。擁壁の造り替えや深基礎が必要な場合、数百万円単位の追加費用が発生することがあります。',
      severity: 'caution',
    });
  }
  if (l.status && /古家|建物/.test(l.status)) {
    items.push({
      category: '土地・造成',
      title: '古家あり',
      detail: '解体費（木造30坪で150〜250万円程度が目安）、滅失登記、アスベスト事前調査の要否を見込んでください。',
      severity: 'info',
    });
  }
  if (l.buildingCondition) {
    items.push({
      category: 'その他',
      title: '建築条件付き土地',
      detail: '指定の施工会社と一定期間内（多くは3か月以内）に建築請負契約を結ぶ必要があります。自由設計の範囲とプラン変更の可否を確認してください。',
      severity: 'caution',
    });
  }

  // 備考・その他制限からキーワード抽出
  const text = [...(l.otherRestrictions ?? []), l.notes ?? ''].join(' ');
  for (const k of KEYWORD_RULES) if (k.re.test(text)) items.push(k.item);

  items.push(...ordinanceItems(l));

  return { items, volume };
}
