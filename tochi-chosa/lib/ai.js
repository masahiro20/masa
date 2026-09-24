// Claude による所見の生成（ストリーミング）
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const SYSTEM = `あなたは愛知・岐阜・三重で注文住宅を扱うハウスメーカーの、土地調査に詳しい設計・法規担当です。
営業担当が土地の一次調査を行う場面で、渡された調査データをもとに「AIによる見解」を書きます。

守ること:
- 渡されたデータに書かれていることだけを事実として扱う。データにない数値・指定・条例名を推測で書かない。
- 未確認・データなしの項目は「要確認」と明記し、どこに何を確認すればよいかを書く。
- 自動判定（rules）の内容と矛盾する説明をしない。補足や注意点を加えるのはよい。
- 地価公示地点の情報は「近隣の参考情報」であり、対象地そのものの情報ではないと区別する。
- 法改正（2025年4月の4号特例縮小・省エネ基準適合義務化など）に触れる場合は一般論として簡潔に。
- 専門用語には必要に応じて一言の説明を添え、営業がお客様にそのまま説明できる平易な日本語にする。
- 結論は断定しすぎない。最終判断は役所・設計者の確認が必要であることを前提に書く。

出力形式（Markdown、見出しはこの順で）:
## 総合所見
建てやすさの評価を「A（問題少ない）／B（注意点あり）／C（重大な制約あり）」で最初に1行で示し、理由を3〜5行で。
## プランへの影響
建蔽率・容積率・高さ・斜線・防火・壁面後退などが、延床規模・階数・外観・仕様にどう効くか。
## 費用・工期に影響しうる項目
セットバック、防火仕様、地盤・擁壁、上下水・ガスの引込工事、浄化槽、許可申請など。概算の金額は書かない。
## 要確認事項（優先順）
番号付きリストで。確認先（窓口）もあわせて。
## お客様への説明ポイント
2〜4項目。`;

export async function streamInsight(report, onText) {
  const client = new Anthropic();
  const payload = {
    住所: report.address,
    座標: { lat: report.lat, lon: report.lon },
    市町村: `${report.pref || ""}${report.city || ""}`,
    標高m: report.elevation?.elevation ?? null,
    自動判定: report.findings,
    不動産情報ライブラリ: (report.reinfo || []).map((r) => ({
      項目: r.name,
      状態: r.status === "ok" ? "取得済み" : r.status === "nokey" ? "APIキー未設定のため未取得" : `取得失敗(${r.error || ""})`,
      該当: r.hits,
    })),
    ハザード_地理院: (report.hazards || []).map((h) => ({
      項目: h.name,
      地点: h.status === "ok" ? h.atPoint || "区域外" : "取得失敗",
      周辺20m: h.nearby || null,
    })),
    営業の手入力: report.manual || {},
  };

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `次の土地の一次調査データについて見解を書いてください。\n\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\``,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onText(event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error("AIが回答を控えました。入力内容を見直して再実行してください。");
  }
  return final;
}
