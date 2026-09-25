// 任意機能：Claude API で地域特性の調査（Web検索）と、お客様向けの提案コメントを生成する。
// ANTHROPIC_API_KEY（または ant auth login のプロファイル）が設定されている場合のみ有効。
import Anthropic from '@anthropic-ai/sdk';
import type { ListingInsight } from '../../shared/types';
import { formatManYen } from '../../shared/units';

export const AI_MODEL = process.env.LAND_FINDER_AI_MODEL ?? 'claude-opus-5';

// ant auth login のプロファイルで認証する場合は LAND_FINDER_AI=on を設定
export const aiAvailable = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.LAND_FINDER_AI === 'on');

const SYSTEM = `あなたは戸建て住宅用の土地探しを支援する不動産・建築のアドバイザーです。
与えられた候補地の情報（条件適合度・ハザード判定・法令チェック・周辺施設）をもとに、住宅会社の営業担当がお客様に提案するためのコメントを日本語で作成します。

- 地域特性（街の雰囲気、子育て・教育環境、買い物・医療、交通、自治体の支援制度、地価動向など）はWeb検索で最新の公的・信頼できる情報を確認し、根拠のある内容だけを書いてください。
- ハザードや法令の注意点は、与えられた判定結果と矛盾しないように書き、断定できないことは「要確認」と明記してください。
- お客様にそのまま見せられる丁寧な文体で、以下の見出し構成のMarkdownで出力してください。
  ## 地域の特性
  ## この土地のおすすめポイント
  ## 注意点と対策
  ## 総合コメント
- 各見出しの下は3〜5個の箇条書き（総合コメントは2〜3文の段落）にしてください。`;

export interface AiProposal {
  markdown: string;
  sources: { title: string; url: string }[];
  model: string;
}

function describe(insight: ListingInsight, criteriaText: string): string {
  const l = insight.listing;
  const h = insight.hazard;
  return [
    `# 候補地`,
    `所在地: ${l.prefecture}${l.city}${l.address}`,
    `価格: ${formatManYen(l.price)} / 土地面積: ${l.landArea}㎡`,
    `交通: ${l.stations.map((s) => `${s.line ?? ''}「${s.name}」${s.bus ? `バス${s.bus}分` : ''}徒歩${s.walk ?? '?'}分`).join('、')}`,
    `用途地域: ${l.zoning ?? '不明'} / 建ぺい率${l.coverageRatio ?? '-'}% / 容積率${l.floorAreaRatio ?? '-'}% / ${l.fireZone ?? ''}`,
    `接道: ${l.roads.map((r) => `${r.direction ?? ''}側 幅員${r.width ?? '?'}m ${r.kind ?? ''}`).join('、') || '不明'}`,
    `形状・地勢: ${l.shape ?? '-'} / ${l.terrain ?? '-'}`,
    `その他制限: ${(l.otherRestrictions ?? []).join('、') || 'なし'}`,
    '',
    `# 希望条件との適合`,
    criteriaText,
    '',
    `# ハザード判定（重ねるハザードマップより自動判定）`,
    h ? h.opinions.map((o) => `- ${o.title}: ${o.body}`).join('\n') : '取得できませんでした',
    h?.elevation != null ? `標高: ${h.elevation}m` : '',
    '',
    `# 法令チェック`,
    insight.regulations.items.map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`).join('\n'),
    '',
    `# 周辺施設（半径800m、OpenStreetMap）`,
    insight.area.facilities?.map((f) => `- ${f.label}: ${f.count}件${f.nearestMeters != null ? `（最寄り約${f.nearestMeters}m）` : ''}`).join('\n') ?? '取得できませんでした',
  ].join('\n');
}

export async function generateAiProposal(insight: ListingInsight, criteriaText: string): Promise<AiProposal> {
  const client = new Anthropic();
  let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: describe(insight, criteriaText) }];

  // Web検索のサーバーツールは pause_turn で一時停止することがあるため、数回まで再開する
  for (let i = 0; i < 4; i++) {
    const stream = client.beta.messages.stream({
      model: AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'JP' } }],
      messages,
    });
    const response = await stream.finalMessage();

    if (response.stop_reason === 'pause_turn') {
      messages = [messages[0], { role: 'assistant', content: response.content }];
      continue;
    }
    if (response.stop_reason === 'refusal') {
      throw new Error('AIが回答を控えました。条件を変えて再度お試しください。');
    }

    const sources = new Map<string, string>();
    let markdown = '';
    for (const block of response.content) {
      if (block.type !== 'text') continue;
      markdown += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location') sources.set(c.url, c.title ?? c.url);
      }
    }
    return {
      markdown: markdown.trim(),
      sources: [...sources].map(([url, title]) => ({ url, title })),
      model: response.model,
    };
  }
  throw new Error('AI提案の生成が完了しませんでした（検索の継続回数上限）。');
}
