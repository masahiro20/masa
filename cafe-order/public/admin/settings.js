// 設定：お店の情報・番号札とQR印刷・チケット・割引・支払い方法・税・受付ルール・バックアップ
import { S, esc, yen, api, run, refresh, toast, printHtml, confirmDialog, promptDialog, uid, hooks } from './core.js';

let draft = null;
export function resetSettingsDraft() { draft = null; }

function ensureDraft() {
  if (!draft) draft = structuredClone(S.data.settings);
  return draft;
}

const field = (label, path, { type = 'text', ph = '', help = '' } = {}) => {
  const v = path.split('.').reduce((o, k) => o?.[k], draft);
  return `<label>${label}<input type="${type}" data-sp="${path}" ${type === 'number' ? 'data-type="num" inputmode="numeric"' : ''} value="${esc(v ?? '')}" placeholder="${esc(ph)}">${help ? `<span class="small muted">${help}</span>` : ''}</label>`;
};
const select = (label, path, options, help = '') => {
  const v = path.split('.').reduce((o, k) => o?.[k], draft);
  return `<label>${label}<select data-sp="${path}">${options.map(([k, l]) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${l}</option>`).join('')}</select>${help ? `<span class="small muted">${help}</span>` : ''}</label>`;
};

function paypaySection(d) {
  d.paypay ||= { mode: 'off' };
  const st = S.data.paypay || {};
  const mode = d.paypay.mode;
  const fromEnv = st.source === 'env';
  return `${select('使い方', 'paypay.mode', [['off', '使わない'], ['simulator', 'テストモード（お金は動きません）'], ['sandbox', 'PayPayのテスト環境（sandbox）'], ['production', '本番（実際に決済）']])}
    <p class="small muted">会計で「PayPay」を選ぶと、iPadに<b>金額入りのQRコード</b>が出ます。お客様がPayPayアプリで読み取って支払うと、自動で会計に記録されます（打ち間違い・確認の手間なし）。手数料はPayPayとの契約どおり（初期費用0円）です。</p>
    ${mode === 'sandbox' || mode === 'production' ? `
      ${fromEnv ? '<div class="warnbox">キーはサーバーの環境変数で設定されています（ここでの入力より優先）。</div>' : ''}
      <label>加盟店ID（MERCHANT ID）<input data-sp="paypay.merchantId" value="${esc(d.paypay.merchantId ?? '')}" placeholder="${esc(st.merchantId || '例：123456789…')}" autocomplete="off"></label>
      <label>APIキー<input data-sp="paypay.apiKey" value="${esc(d.paypay.apiKey ?? '')}" placeholder="${st.hasKey ? '設定済み（変更するときだけ入力）' : 'a_xxxxxxxx…'}" autocomplete="off"></label>
      <label>APIシークレット<input type="password" data-sp="paypay.apiSecret" value="" placeholder="${st.hasSecret ? '設定済み（変更するときだけ入力）' : '入力すると以後は表示されません'}" autocomplete="new-password"></label>
      <div class="row wrap"><button class="btn" data-act="st-pp-check">接続テスト</button><span class="small muted">${st.configured ? '✓ キーが設定されています' : 'キーが未設定です'}</span></div>
      <details class="small"><summary>キーの取り方</summary><ol>
        <li>PayPay の加盟店申込（お店の決済。初期費用0円）を済ませる</li>
        <li>「PayPay for Developers」に登録し、オンライン決済（ウェブペイメント）を申し込む（審査あり）</li>
        <li>管理画面の「設定」から APIキー・シークレット・加盟店ID をコピーして、ここに貼る</li>
        <li>まず「テスト環境（sandbox）」のキーで動作を確かめ、審査後に本番のキーに入れ替える</li></ol></details>` : ''}
    ${mode === 'simulator' ? '<div class="warnbox">テストモードです。QRを読み取っても実際のお金は動かず、売上には「PayPay（テスト）」として記録されます。営業前に「使わない」か本番に切り替えてください。</div>' : ''}`;
}

function printerSection(d, base) {
  d.printer ||= { type: 'none', port: 9100, paper: 80, drawer: true };
  const p = d.printer;
  const sdpUrl = `${base}/api/printer/epson?token=${encodeURIComponent((S.data.settings.printer || {}).token || '')}`;
  return `${select('つなぎ方', 'printer.type', [['none', '使わない（iPadからAirPrintで印刷）'], ['escpos-net', '店内LANのレシートプリンターに直接（ESC/POS）'], ['epson-sdp', 'EPSON Server Direct Print（クラウドでも可）']])}
    ${p.type === 'escpos-net' ? `<div class="grid2">${field('プリンターのIPアドレス', 'printer.host', { ph: '192.168.0.50' })}${field('ポート', 'printer.port', { type: 'number' })}</div>
      <p class="small muted">EPSON TM-m30・Star mC-Print など、LANケーブルかWi-Fiでつながるレシートプリンター向けです。このシステムのサーバーを<b>店内のパソコン</b>で動かしているときに使えます。</p>` : ''}
    ${p.type === 'epson-sdp' ? `<p class="small muted">EPSON TM-m30 などの「Server Direct Print」機能を使います。プリンターの設定画面（ブラウザでプリンターのIPアドレスを開く）で、次のURLを登録してください。プリンターが数秒おきに印刷データを取りに来ます。</p>
      <div class="copybox"><code>${esc(sdpUrl)}</code></div>` : ''}
    ${p.type !== 'none' ? `${select('用紙の幅', 'printer.paper', [[80, '80mm'], [58, '58mm']])}
      ${toggle('現金の会計でキャッシュドロアを開ける', 'printer.drawer', 'プリンターにつないだドロアが開きます')}
      ${toggle('会計が終わったらレシートを自動で印刷', 'printer.autoReceipt')}
      ${toggle('注文が入ったらキッチン伝票を印刷', 'printer.kitchenTicket')}
      <div class="row wrap"><button class="btn" data-act="st-print-test">テスト印刷</button><button class="btn" data-act="co-drawer">ドロアを開ける</button>
        <span class="small muted">変更は「保存」してから試してください</span></div>` : ''}`;
}

const toggle = (label, path, help = '') => {
  const v = path.split('.').reduce((o, k) => o?.[k], draft);
  return `<label class="check big"><input type="checkbox" data-sp="${path}" data-type="bool" ${v ? 'checked' : ''}> <span><b>${label}</b>${help ? `<br><span class="small muted">${help}</span>` : ''}</span></label>`;
};

export function renderSettings() {
  const d = ensureDraft();
  const base = d.publicBaseUrl || S.publicBase;
  return `<div class="view-head"><h1>設定</h1><span class="spacer"></span><button class="btn" data-act="st-reset">変更を破棄</button><button class="btn btn-primary btn-lg" data-act="st-save">保存</button></div>
  <div class="settings">
    <section class="card pad"><h3>お店の情報</h3>
      ${field('店名', 'shopName')}
      ${field('お客様が最初に見るメッセージ', 'welcome')}
      ${field('住所（レシート用）', 'receipt.address')}
      ${field('電話番号（レシート用）', 'receipt.phone')}
      ${field('インボイス登録番号', 'receipt.invoiceNumber', { ph: 'T1234567890123', help: '適格簡易請求書（レシート）に印字されます' })}
      ${field('レシートの最後の一言', 'receipt.footer')}
    </section>

    <section class="card pad"><h3>番号札とQRコード</h3>
      ${field('席数（合計）', 'seatCount', { type: 'number', help: 'カウンター＋テーブルの合計。ホール画面に「席 5/12 残り7席」のように表示します（0で非表示）' })}
      ${field('番号札の枚数', 'tagCount', { type: 'number' })}
      ${field('お客様がアクセスするURL', 'publicBaseUrl', { ph: S.publicBase, help: `QRコードに埋め込むアドレス。空欄なら今開いているアドレス（${esc(S.publicBase)}）を使います。` })}
      <div class="row wrap" style="margin-top:8px"><button class="btn btn-primary" data-act="st-print-tags">🖨 番号札（QR）を印刷</button>
        <button class="btn" data-act="st-rekey">札をなくした時：QRを再発行</button></div>
      ${/localhost|127\.0\.0\.1/.test(base) ? '<div class="warnbox">⚠️ このアドレスはお客様のスマホから開けません。インターネットに公開したURL（例：https://cafe.example.com）を入力してから印刷してください。</div>' : ''}
      <p class="small muted">各札のQRには推測できない鍵が入っています。札を紛失した場合は再発行すると古いQRは使えなくなります。<br>現在のQR例：${esc(base)}/t/1?k=…</p>
    </section>

    <section class="card pad"><h3>注文の受付ルール</h3>
      ${toggle('スタッフが受付した札だけスマホ注文できる', 'requireStaffOpen', 'オフ：お客様がQRから最初に注文した時点で自動で受付（オーナーの手間が最小）。オン：ホール画面で札を「受付」してから注文可能に（いたずら防止）。')}
      ${toggle('最初の注文時に人数をたずねる', 'askPeople')}
      ${toggle('新しい注文・呼び出しで音を鳴らす', 'newOrderSound')}
      ${field('ラストオーダー', 'lastOrder', { type: 'time' })}
      ${field('営業日の切り替え時刻（時）', 'businessDayStartHour', { type: 'number', help: '例：4 → 深夜0〜4時の会計は前日の売上として集計' })}
      <label>お客様の呼び出しボタン（1行に1つ）<textarea data-sl="callOptions" rows="3">${esc(d.callOptions.join('\n'))}</textarea></label>
    </section>

    <section class="card pad"><h3>コーヒーチケット（回数券）</h3>
      ${toggle('チケットを使う', 'ticket.enabled')}
      ${field('名前', 'ticket.name')}
      ${field('1枚で値引きする上限額（円）', 'ticket.value', { type: 'number', help: `対象商品1点につき1枚。例：${yen(d.ticket.value || 500)}のチケットで650円のラテ → 差額150円をお支払い。対象商品はメニュー編集で設定します。` })}
    </section>

    <section class="card pad"><h3>割引ボタン</h3>
      ${d.discounts.map((x, i) => `<div class="row" style="margin-bottom:6px"><input data-disc="${i}" data-k="name" value="${esc(x.name)}" placeholder="名前">
        <select data-disc="${i}" data-k="type" style="width:110px"><option value="amount" ${x.type === 'amount' ? 'selected' : ''}>円引き</option><option value="percent" ${x.type === 'percent' ? 'selected' : ''}>％引き</option></select>
        <input type="number" data-disc="${i}" data-k="value" value="${x.value}" style="width:100px"><button class="btn btn-sm btn-danger" data-act="st-disc-del" data-i="${i}">削除</button></div>`).join('')}
      <button class="btn btn-sm" data-act="st-disc-add">＋ 割引を追加</button>
      <p class="small muted">スタンプカード・学割・お詫びなど、よく使う割引を登録しておくと会計時にワンタップです。</p>
    </section>

    <section class="card pad"><h3>電子決済（PayPay）</h3>
      ${paypaySection(d)}
    </section>

    <section class="card pad"><h3>レシートプリンター・キャッシュドロア</h3>
      ${printerSection(d, base)}
    </section>

    <section class="card pad"><h3>支払い方法・税率</h3>
      <label>支払い方法（1行に1つ。「現金」は必須）<textarea data-sl="paymentMethods" rows="4">${esc(d.paymentMethods.join('\n'))}</textarea></label>
      <div class="grid2">${field('店内飲食の税率（%）', 'taxRate', { type: 'number' })}${field('持ち帰りの税率（%）', 'takeoutTaxRate', { type: 'number' })}</div>
      <p class="small muted">価格はすべて税込で登録し、レシートには税率ごとの内消費税を表示します。</p>
    </section>

    <section class="card pad"><h3>セキュリティ・データ</h3>
      <div class="row wrap"><button class="btn" data-act="st-pin">オーナーPINを変更</button>
        <a class="btn" href="/api/admin/backup">バックアップをダウンロード</a>
        <button class="btn" data-act="st-logout">この端末からログアウト</button></div>
      <p class="small muted">データはサーバーの data フォルダに保存されています。月に1回程度バックアップを保存しておくと安心です。</p>
    </section>
  </div>`;
}

export function settingsInput(el) {
  if (!draft) return false;
  if (el.dataset.sp) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'num') v = Number(v) || 0;
    const ks = el.dataset.sp.split('.');
    let o = draft;
    for (const k of ks.slice(0, -1)) o = o[k];
    o[ks.at(-1)] = v;
    if (el.tagName === 'SELECT') hooks.renderMain(); // 選んだ内容で入力欄が変わる
    return true;
  }
  if (el.dataset.sl) { draft[el.dataset.sl] = el.value.split('\n').map((x) => x.trim()).filter(Boolean); return true; }
  if (el.dataset.disc != null) {
    const x = draft.discounts[Number(el.dataset.disc)];
    x[el.dataset.k] = el.dataset.k === 'value' ? Number(el.value) || 0 : el.value;
    return true;
  }
  return false;
}

function tagsPrintHtml() {
  const s = S.data.settings;
  return `<div class="tagsheet">${S.data.tags.map((t) => `<div class="tagcard"><div class="tc-shop">${esc(s.shopName)}</div><div class="tc-no">${t.no}</div>
    <img src="/api/admin/qr/${t.no}?v=${encodeURIComponent(t.key)}" alt=""><div class="tc-msg">スマホで読み取って<br>テーブルからご注文ください</div>
    <div class="tc-sub">お会計の際はこの札をレジへお持ちください</div></div>`).join('')}</div>`;
}

export const settingsActions = {
  'st-save': async (el, ev, rerender) => {
    const { adminPin, ...body } = draft;
    const ok = await run(() => api('PUT', '/api/admin/settings', body));
    if (!ok) return;
    toast('設定を保存しました');
    draft = null;
    await refresh();
    rerender();
  },
  'st-reset': (el, ev, rerender) => { draft = null; rerender(); },
  'st-disc-add': (el, ev, rerender) => { draft.discounts.push({ id: `d${uid()}`, name: '', type: 'amount', value: 100 }); rerender(); },
  'st-disc-del': (el, ev, rerender) => { draft.discounts.splice(Number(el.dataset.i), 1); rerender(); },
  'st-print-tags': async () => {
    if (draft && (draft.tagCount !== S.data.settings.tagCount || draft.publicBaseUrl !== S.data.settings.publicBaseUrl)) {
      toast('先に「保存」を押してから印刷してください', 'error'); return;
    }
    printHtml(tagsPrintHtml(), { waitImages: true });
  },
  'st-rekey': async () => {
    const no = await promptDialog('QRを再発行する番号札の番号', { type: 'number', ok: '再発行' });
    if (!no) return;
    if (!(await confirmDialog(`${no}番のQRを再発行します。古い${no}番の札は使えなくなります。`, { ok: '再発行', danger: true }))) return;
    await run(async () => { await api('POST', `/api/admin/tags/${no}/rekey`); await refresh(); toast(`${no}番のQRを再発行しました。印刷して札を作り直してください`); });
  },
  'st-pp-check': async () => {
    if (draft && JSON.stringify(draft.paypay) !== JSON.stringify(S.data.settings.paypay)) { toast('先に「保存」を押してから試してください', 'error'); return; }
    const r = await run(() => api('POST', '/api/admin/paypay/check'));
    if (r) toast(`PayPayに接続できました（${r.mode === 'production' ? '本番' : r.mode === 'sandbox' ? 'テスト環境' : 'テストモード'}）`);
  },
  'st-print-test': async () => {
    const r = await run(() => api('POST', '/api/admin/print/test'));
    if (r) toast(r.queued ? 'プリンターに送りました。数秒で印刷されます' : r.sent ? 'テスト印刷を送りました' : 'プリンターが「使わない」になっています');
  },
  'st-pin': async () => {
    const pin = await promptDialog('新しいPIN（4〜12桁の数字）', { type: 'password', ok: '変更' });
    if (!pin) return;
    const again = await promptDialog('確認のためもう一度', { type: 'password', ok: '変更' });
    if (pin !== again) { toast('PINが一致しません', 'error'); return; }
    await run(async () => { await api('PUT', '/api/admin/settings', { adminPin: pin }); toast('PINを変更しました'); });
  },
  'st-logout': async () => { await api('POST', '/api/admin/logout'); location.reload(); },
};
