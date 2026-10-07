// 一般向け「土地しらべ」：住所 → 位置の確認 → レポート（A4・PDF保存）
import { deriveFindings, heightRules } from "../shared/rules.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { candidates: [], survey: null, manual: {}, ai: "", photos: [], id: null, aiRunning: false };

// ---------- この端末への保存（使えない環境でも動くように） ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 容量超過・プライベートモードなどは保存しない */
    }
  },
};

function saveHistory() {
  if (!state.survey) return;
  const list = store.get("tochishirabe.history", []).filter((h) => h.id !== state.id);
  // 写真は容量が大きいので履歴には残さない
  list.unshift({ id: state.id, address: state.survey.address, date: new Date().toISOString(), survey: state.survey, manual: state.manual, ai: state.ai });
  store.set("tochishirabe.history", list.slice(0, 15));
}

// ---------- 画面の切り替え ----------
function show(view) {
  for (const id of ["home", "locate", "loading", "result"]) $(`#${id}`).hidden = id !== view;
  window.scrollTo({ top: 0 });
  if (view === "locate") setTimeout(() => map?.invalidateSize(), 60);
}

function setStatus(el, text, isError = false) {
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("error", isError);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const code = store.get("tochishirabe.passcode", "");
  if (code) headers["x-app-passcode"] = code;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const input = prompt("合言葉を入力してください");
    if (input == null) throw new Error("合言葉が必要です");
    store.set("tochishirabe.passcode", input);
    return api(url, options);
  }
  return res;
}

// ---------- 1. 住所検索 ----------
async function search(q) {
  setStatus($("#homeStatus"), "住所を検索しています…");
  const res = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "住所検索に失敗しました");
  const list = data.candidates || [];
  if (!list.length) throw new Error("住所が見つかりませんでした。番地を省く・表記を変えるなどしてお試しください。");
  setStatus($("#homeStatus"), "");
  state.candidates = list;
  openLocate(list[0].lat, list[0].lon, list[0].title);
}

// ---------- 2. 位置の確認（Leaflet） ----------
let map, marker, bases, pending = null;
function ensureMap() {
  if (map) return true;
  if (!window.L) return false;
  map = L.map("map", { zoomControl: true });
  const attribution = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  bases = {
    photo: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { maxZoom: 20, maxNativeZoom: 18, attribution }),
    pale: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 18, attribution }),
  };
  bases.photo.addTo(map);
  marker = L.marker([35, 137], { draggable: true }).addTo(map);
  marker.on("dragend", () => setPending(marker.getLatLng().lat, marker.getLatLng().lng, ""));
  map.on("click", (e) => {
    marker.setLatLng(e.latlng);
    setPending(e.latlng.lat, e.latlng.lng, "");
  });
  return true;
}

function setPending(lat, lon, title) {
  pending = { lat, lon, title: title || pending?.title || "" };
  $("#pinInfo").textContent = `${pending.title ? `${pending.title}　` : ""}（${lat.toFixed(6)}, ${lon.toFixed(6)}）`;
}

function openLocate(lat, lon, title) {
  show("locate");
  setPending(lat, lon, title);
  if (!ensureMap()) {
    // 地図が読めない環境では、そのまま調査に進める
    $("#pinInfo").textContent += "　※地図を読み込めませんでした。この位置で調べます。";
    return;
  }
  marker.setLatLng([lat, lon]);
  map.setView([lat, lon], 18);
  const box = $("#candidateBox");
  box.hidden = state.candidates.length < 2;
  $("#candidates").innerHTML = state.candidates
    .map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.title)}</button></li>`)
    .join("");
}

$("#candidates").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  const c = state.candidates[Number(b.dataset.i)];
  marker.setLatLng([c.lat, c.lon]);
  map.setView([c.lat, c.lon], 18);
  setPending(c.lat, c.lon, c.title);
});

document.querySelector(".map-switch").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-base]");
  if (!b || !map) return;
  for (const [k, layer] of Object.entries(bases)) {
    if (k === b.dataset.base) layer.addTo(map);
    else map.removeLayer(layer);
  }
  for (const x of document.querySelectorAll(".map-switch button")) x.classList.toggle("on", x === b);
});

// ---------- 3. 調査 ----------
async function runSurvey({ lat, lon, title }) {
  show("loading");
  const items = [...document.querySelectorAll("#progress li")];
  items.forEach((li) => (li.className = ""));
  let step = 0;
  items[0].className = "on";
  const timer = setInterval(() => {
    if (step < items.length - 1) {
      items[step].className = "done";
      items[++step].className = "on";
    }
  }, 2600);
  try {
    const res = await api("/api/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon, address: title || $("#address").value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "調査に失敗しました");
    items.forEach((li) => (li.className = "done"));
    state.survey = data;
    state.manual = {};
    state.ai = "";
    state.photos = [];
    state.id = `${Date.now()}`;
    fillManualForm();
    renderPhotos();
    renderReport();
    saveHistory();
    show("result");
    setStatus($("#resultStatus"), data.hasReinfoKey ? "" : "都市計画データ（用途地域など）を取得できない設定のため、ハザード・標高のみのレポートです。");
  } finally {
    clearInterval(timer);
  }
}

// ---------- 4. レポート ----------
const TAG = { info: ["ok", "OK"], warn: ["warn", "注意"], danger: ["ng", "重大"], check: ["chk", "要確認"], none: ["na", "未取得"] };
const tag = (level) => {
  const [cls, label] = TAG[level] || TAG.none;
  return `<span class="tag ${cls}">${label}</span>`;
};
const ORDER = ["danger", "warn", "check", "info", "none"];
const worst = (items) => ORDER.find((lv) => items.some((f) => f.level === lv)) || "info";
const HAZARD_KEY = (k) => k.startsWith("hz_") || k.startsWith("rf_") || k === "liquefaction";

const hits = (s, id) => {
  const r = s.reinfo.find((x) => x.id === id);
  return r?.status === "ok" ? r.hits || [] : null;
};
const yesNo = (v) => (v === true || v === "true" ? "あり" : v === false || v === "false" ? "なし" : "-");
const fmtDate = (d) => new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

// 地理院タイルを並べた静的な地図（SVG）。画面でも印刷でもそのまま使える
function lonLatToPixel(lat, lon, z) {
  const n = 2 ** z * 256;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}
function mosaic({ lat, lon, z, layers, w = 640, h = 440, ring = 26, label }) {
  const [px, py] = lonLatToPixel(lat, lon, z);
  const left = px - w / 2;
  const top = py - h / 2;
  const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
  const tiles = [];
  for (const layer of layers) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w) / 256); tx++) {
      for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h) / 256); ty++) {
        const url = layer.url.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
        // 区域外のハザードタイルは 404 になるので、壊れた画像アイコンを出さずに消す
        tiles.push(`<img src="${url}" alt="" loading="eager" onerror="this.remove()" style="left:${pct(tx * 256 - left, w)};top:${pct(ty * 256 - top, h)};width:${pct(256, w)};height:${pct(256, h)};opacity:${layer.opacity ?? 1}">`);
      }
    }
  }
  const r = (ring / w) * 100;
  return `<div class="mosaic" role="img" aria-label="${esc(label || "地図")}" style="aspect-ratio:${w}/${h}">
    ${tiles.join("")}
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <circle cx="${w / 2}" cy="${h / 2}" r="${ring}" fill="none" stroke="#fff" stroke-width="7" opacity=".85"/>
      <circle cx="${w / 2}" cy="${h / 2}" r="${ring}" fill="none" stroke="#d62828" stroke-width="4"/>
      <circle cx="${w / 2}" cy="${h / 2}" r="3.5" fill="#d62828"/>
    </svg>
  </div>`;
}
const GSI = (id, ext = "png") => `https://cyberjapandata.gsi.go.jp/xyz/${id}/{z}/{x}/{y}.${ext}`;
const DISA = (id) => `https://disaportaldata.gsi.go.jp/raster/${id}/{z}/{x}/{y}.png`;

function summary(findings) {
  const cnt = (lv) => findings.filter((f) => f.level === lv);
  const danger = cnt("danger");
  const warn = cnt("warn");
  const check = cnt("check");
  const level = danger.length ? "ng" : warn.length ? "warn" : "ok";
  const head = danger.length
    ? `重大な制約が${danger.length}件あります。購入・計画の前に必ず確認してください。`
    : warn.length
      ? `大きな制約は見当たりませんが、注意点が${warn.length}件あります。`
      : "公開データの範囲では、大きな制約は見当たりません。";
  const list = [...danger, ...warn].slice(0, 6).map((f) => `<li><b>${esc(f.label)}</b>：${esc(f.value)}</li>`).join("");
  return `<div class="callout ${level}">
    <b class="head">${esc(head)}</b>
    ${list ? `<ul>${list}</ul>` : ""}
    ${check.length ? `<p class="small" style="margin-top:6px">ほかに「要確認」が${check.length}件あります（役所・事業者に確認が必要な項目）。</p>` : ""}
  </div>`;
}

function areaShort(f) {
  const v = f?.value || "";
  if (v.includes("非線引き")) return "非線引き区域";
  if (v.includes("調整")) return "市街化調整区域";
  if (v.includes("市街化区域")) return "市街化区域";
  return v || "データなし";
}

function renderReport() {
  const s = state.survey;
  if (!s) return;
  const m = state.manual;
  const { zone, zoneName, bcr, far, fire, findings } = deriveFindings({ reinfo: s.reinfo, hazards: s.hazards, manual: m, city: s.city });
  state.findings = findings;
  const get = (k) => findings.find((f) => f.key === k);
  const rows = (keys) => keys.map(get).filter(Boolean);
  const today = fmtDate(new Date());
  const hz = findings.filter((f) => HAZARD_KEY(f.key));
  const hzLevel = hz.length ? worst(hz.filter((f) => f.level !== "info")) : "info";
  const elem = hits(s, "elementarySchool")?.[0];
  const junior = hits(s, "juniorHighSchool")?.[0];
  const prices = hits(s, "landPrice") || [];
  const district = hits(s, "districtPlan") || [];

  const findingRow = (f) =>
    `<tr><th>${esc(f.label)}</th><td>${esc(f.value)}${f.note ? `<span class="note">${esc(f.note)}</span>` : ""}</td><td class="tagcol">${tag(f.level)}</td></tr>`;

  // ---- 1枚目：概要 ----
  const kpi = (l, v, sub) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub || "")}</div></div>`;
  const page1 = `<section class="sheet">
    <h1>土地調査レポート</h1>
    <div class="sheet-meta"><span>${esc(s.address)}</span><span>作成日 ${today}</span></div>
    ${summary(findings)}
    <div class="kpis">
      ${kpi("用途地域", zoneName ? zoneName.replace(/地域$/, "") : s.hasReinfoKey ? "指定なし" : "未取得", areaShort(get("areaDivision")))}
      ${kpi("建蔽率／容積率", bcr != null ? `${bcr}%／${far ?? "-"}%` : "要確認", get("far")?.value.includes("実効") ? get("far").value.replace(/^.*→ /, "") : "")}
      ${kpi("防火指定", fire || (s.hasReinfoKey ? "指定なし" : "未取得"), fire ? "" : "22条区域は要確認")}
      ${kpi("災害リスク", hzLevel === "info" ? "想定区域外" : hzLevel === "danger" ? "要注意" : "注意あり", "洪水・土砂・津波・液状化")}
    </div>
    <table>
      <tr><th>所在地</th><td>${esc(s.address)}</td></tr>
      <tr><th>位置</th><td>緯度 ${s.lat.toFixed(6)}　経度 ${s.lon.toFixed(6)}</td></tr>
      <tr><th>標高</th><td>${s.elevation?.elevation != null ? `約${s.elevation.elevation}m` : "取得できませんでした"}</td></tr>
      ${get("landCategory") ? `<tr><th>地目</th><td>${esc(get("landCategory").value)}</td></tr>` : ""}
      ${m.lotArea ? `<tr><th>敷地面積</th><td>${esc(m.lotArea)}㎡（約${(Number(m.lotArea) * 0.3025).toFixed(1)}坪）</td></tr>` : ""}
      <tr><th>学区</th><td>${elem ? `${esc(elem.学校)}` : "-"}${junior ? `／${esc(junior.学校)}` : ""}</td></tr>
      ${m.memo ? `<tr><th>メモ</th><td>${esc(m.memo).replace(/\n/g, "<br>")}</td></tr>` : ""}
    </table>
    <div class="maps">
      <figure>${mosaic({ lat: s.lat, lon: s.lon, z: 15, layers: [{ url: GSI("pale") }], ring: 16, label: "位置図" })}<figcaption>位置図（地理院地図 淡色）</figcaption></figure>
      <figure>${mosaic({ lat: s.lat, lon: s.lon, z: 18, layers: [{ url: GSI("seamlessphoto", "jpg") }], ring: 34, label: "航空写真" })}<figcaption>航空写真（国土地理院 シームレス空中写真）</figcaption></figure>
    </div>
  </section>`;

  // ---- 2枚目：法令制限 ----
  const h = heightRules(zone, far);
  const districtRow = district.length
    ? `<tr><th>地区計画</th><td>${esc(district.map((d) => d.計画名).join("、"))}<span class="note">建物の用途・高さ・壁面の位置・敷地の最低面積などが定められている可能性があります。市町村で計画書を確認してください。</span></td><td class="tagcol">${tag("warn")}</td></tr>`
    : s.hasReinfoKey ? `<tr><th>地区計画</th><td>指定なし（データ上）</td><td class="tagcol">${tag("info")}</td></tr>` : "";
  const page2 = `<section class="sheet">
    <h2>建築のルール（法令制限）</h2>
    <table>
      ${rows(["areaDivision", "useZone", "bcr", "far"]).map(findingRow).join("")}
      ${get("height") ? `<tr><th>高さ制限</th><td>${esc(h.absolute)}<span class="note">${esc(h.lines.join("／"))}</span><span class="note">${esc(h.shadow)}</span></td><td class="tagcol">${tag(get("height").level)}</td></tr>` : ""}
      ${rows(["wallSetback", "fire"]).map(findingRow).join("")}
      ${districtRow}
      ${rows(["cityPlanRoad", "locationPlan", "landCategory"]).map(findingRow).join("")}
    </table>
    <h2>道路と敷地</h2>
    <table>
      ${rows(["roadType", "roadWidth", "setback", "frontage", "volume"]).map(findingRow).join("")}
    </table>
    <p class="small" style="margin-top:6px">道路の種類（建築基準法上の道路かどうか）は、市町村の建築指導課などで「指定道路図」「道路台帳」を確認できます。家を建てるには、原則として幅4m以上の道路に2m以上接している必要があります。</p>
  </section>`;

  // ---- 3枚目：ライフライン・災害・周辺 ----
  const reinfoHz = ["sediment", "disasterZone", "steepSlopeArea", "landslideArea", "embankment"];
  const hzRows = [
    ...s.hazards.map((x) => {
      if (x.status !== "ok") return `<tr><th>${esc(x.name)}</th><td>取得できませんでした</td><td class="tagcol">${tag("none")}</td></tr>`;
      const lv = x.atPoint ? (/特別|^(3\.0|5\.0|10|20)/.test(x.atPoint) ? "danger" : "warn") : x.nearby ? "check" : "info";
      const text = x.atPoint ? x.atPoint : x.nearby ? `地点は区域外（周辺約20m以内に ${x.nearby}）` : "想定区域外";
      return `<tr><th>${esc(x.name.replace("（想定最大規模）", ""))}</th><td>${esc(text)}</td><td class="tagcol">${tag(lv)}</td></tr>`;
    }),
    ...s.reinfo
      .filter((r) => reinfoHz.includes(r.id) && r.status === "ok")
      .map((r) => {
        const f = get(`rf_${r.id}`);
        return f ? findingRow({ ...f, label: r.name }) : `<tr><th>${esc(r.name)}</th><td>該当なし（データ上）</td><td class="tagcol">${tag("info")}</td></tr>`;
      }),
    get("liquefaction") ? findingRow({ ...get("liquefaction"), label: "液状化の傾向" }) : "",
  ].join("");
  const priceRows = prices.slice(0, 3).map((p) =>
    `<tr><td>${esc(p.所在)}<span class="note">${esc(p.距離)}・${esc(p.用途)}・${esc(p.時点 || "")}</span></td><td>${esc(p.価格)}<span class="note">前年比 ${esc(p.対前年)}</span></td><td>${esc(p.前面道路 || "-")}<span class="note">水道${yesNo(p.水道)}・ガス${yesNo(p.ガス)}・下水${yesNo(p.下水道)}</span></td></tr>`
  ).join("");
  const page3 = `<section class="sheet">
    <h2>ライフライン</h2>
    <table>${rows(["water", "sewer", "gas"]).map(findingRow).join("")}</table>
    <h2>災害リスク（ハザード）</h2>
    <table>${hzRows}</table>
    <div class="maps one" style="margin-top:10px">
      <figure>${mosaic({
        lat: s.lat, lon: s.lon, z: 16, w: 900, h: 320, ring: 18, label: "ハザードマップ",
        layers: [
          { url: GSI("pale") },
          { url: DISA("01_flood_l2_shinsuishin_data"), opacity: 0.65 },
          { url: DISA("05_dosekiryukeikaikuiki"), opacity: 0.7 },
          { url: DISA("05_kyukeishakeikaikuiki"), opacity: 0.7 },
          { url: DISA("05_jisuberikeikaikuiki"), opacity: 0.7 },
        ],
      })}<figcaption>洪水浸水想定（想定最大規模）と土砂災害警戒区域を重ねた図（ハザードマップポータルサイト）。色のない場所は想定区域外です。内水氾濫・ため池は市町村のハザードマップで確認してください。</figcaption></figure>
    </div>
    <h2>周辺の情報</h2>
    <table>
      <tr><th>小学校区</th><td>${elem ? `${esc(elem.学校)}<span class="note">${esc(elem.所在地 || "")}</span>` : "-"}</td></tr>
      <tr><th>中学校区</th><td>${junior ? `${esc(junior.学校)}<span class="note">${esc(junior.所在地 || "")}</span>` : "-"}</td></tr>
    </table>
    ${priceRows ? `<h3>近くの地価公示・地価調査地点（参考）</h3><table><tr><th style="width:auto">所在</th><th style="width:auto">価格（円/㎡）</th><th style="width:auto">前面道路・供給施設</th></tr>${priceRows}</table><p class="small">近隣地点の情報で、この土地そのものの価格や条件ではありません。</p>` : ""}
  </section>`;

  // ---- 4枚目：AI見解・写真 ----
  const aiBody = state.ai
    ? `<div class="ai-body">${renderMarkdown(state.ai)}${state.aiRunning ? '<span class="cursor"></span>' : ""}</div>
       <p class="small" style="margin-top:10px">AIの見解は上の公開データをもとにした参考意見です。正式な判断は役所・専門家に確認してください。</p>`
    : `<div class="ai-cta no-print"><p>調査結果をもとに、AIが「どんな家が建てられそうか」「注意点」「確認すべきこと」をやさしい言葉でまとめます。</p>
       <button type="button" class="btn accent" data-action="ai">AIの見解を作成</button></div>`;
  const page4 = `<section class="sheet ${state.ai ? "" : "empty-print"}">
    <h2>AIによる見解</h2>
    ${aiBody}
  </section>`;
  const page5 = state.photos.length
    ? `<section class="sheet"><h2>現地の写真</h2><div class="photos">${state.photos
        .map((p) => `<figure><img src="${p.src}" alt="${esc(p.caption || "現地写真")}"><figcaption>${esc(p.caption || "")}</figcaption></figure>`)
        .join("")}</div></section>`
    : "";

  // ---- 最終ページ：確認先・用語・出典 ----
  const linkRows = s.links
    .flatMap((g) => g.items.map((i) => `<tr><th>${esc(g.group)}</th><td><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.label)}</a></td></tr>`))
    .join("");
  const page6 = `<section class="sheet">
    <h2>確認先</h2>
    <p class="small">データにない項目や「要確認」の項目は、次の窓口・サイトで確認できます（画面ではリンクをタップで開けます）。</p>
    <table class="links-table">${linkRows}</table>
    <h2>用語のかんたん解説</h2>
    <table>
      ${GLOSSARY.map(([t, d]) => `<tr><th>${esc(t)}</th><td>${esc(d)}</td></tr>`).join("")}
    </table>
    <h2>このレポートについて</h2>
    <p class="small">このレポートは、国土交通省 不動産情報ライブラリ、国土地理院、ハザードマップポータルサイトの公開データをもとに自動で作成した目安です（取得日時：${esc(new Date(s.fetchedAt).toLocaleString("ja-JP"))}）。データの更新時期や精度には限りがあり、「データなし」は「指定なし」を意味しない場合があります。土地の購入・契約・設計の判断は、必ず市町村・各事業者・専門家の確認を受けてください。</p>
    <p class="small">このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。</p>
  </section>`;

  $("#reportPages").innerHTML = page1 + page2 + page3 + page4 + page5 + page6;
}

const GLOSSARY = [
  ["用途地域", "まちを住宅地・商業地・工業地などに分けたもの。建てられる建物の種類や大きさが変わります。"],
  ["建蔽率（けんぺいりつ）", "敷地のうち、建物を建てられる面積（真上から見た広さ）の割合。"],
  ["容積率", "敷地に対する延床面積（各階の床面積の合計）の割合。前面道路が狭いとさらに小さくなります。"],
  ["斜線制限・日影規制", "道路や隣の家の日当たり・風通しを守るための高さのルール。屋根の形や3階建ての可否に影響します。"],
  ["防火地域・準防火地域・22条区域", "火災が広がりにくいよう、外壁・窓・屋根に燃えにくい仕様が求められる区域。費用に影響します。"],
  ["セットバック", "幅4m未満の道路に面する場合、道路の中心から2mの位置まで敷地を下げること。下げた部分には建てられません。"],
  ["市街化調整区域", "市街化を抑える区域。原則として家を建てられず、許可が必要です。"],
  ["非線引き区域", "市街化区域と市街化調整区域の区分をしていない都市計画区域。調整区域のような建築の制限はありません。"],
  ["地区計画", "地区ごとに建物の高さ・用途・塀などのルールを細かく決めたもの。"],
  ["農地転用", "田・畑に家を建てるときに必要な農地法の許可・届出。農業委員会が窓口です。"],
];

// 最低限の Markdown（見出し・箇条書き・番号・太字）
function renderMarkdown(md) {
  const lines = esc(md).split("\n");
  let html = "";
  let list = null;
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const inline = (x) => x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const line of lines) {
    let mm;
    if ((mm = line.match(/^#{1,4}\s+(.*)/))) {
      close();
      html += `<h3>${inline(mm[1])}</h3>`;
    } else if ((mm = line.match(/^\s*[-*・]\s+(.*)/))) {
      if (list !== "ul") { close(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(mm[1])}</li>`;
    } else if ((mm = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { close(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(mm[1])}</li>`;
    } else if (line.trim()) {
      close();
      html += `<p>${inline(line)}</p>`;
    } else close();
  }
  close();
  return html;
}

// ---------- AI見解 ----------
async function generateAi() {
  if (state.aiRunning || !state.survey) return;
  const btn = $("#aiBtn");
  btn.disabled = true;
  state.aiRunning = true;
  state.ai = "";
  setStatus($("#resultStatus"), "AIが調査結果を読んでいます…（1分ほどかかることがあります）");
  try {
    const s = state.survey;
    const res = await api("/api/insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience: "general",
        address: s.address, lat: s.lat, lon: s.lon, pref: s.pref, city: s.city,
        elevation: s.elevation, reinfo: s.reinfo, hazards: s.hazards,
        findings: state.findings, manual: state.manual,
      }),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) throw new Error("AIの見解は現在ご利用いただけません。レポートの他の内容はそのままお使いください。");
      throw new Error(data.error || `AIの見解を作成できませんでした（HTTP ${res.status}）`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let last = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const type = chunk.match(/^event: (.*)$/m)?.[1];
        const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] || "null");
        if (type === "text") state.ai += data;
        else if (type === "error") throw new Error(data.message);
      }
      // 再描画しすぎないよう間引く
      if (Date.now() - last > 250) {
        last = Date.now();
        renderReport();
        if (!document.querySelector(".ai-body")) continue;
        if (!state._scrolled) {
          document.querySelector(".ai-body").closest(".sheet").scrollIntoView({ behavior: "smooth", block: "start" });
          state._scrolled = true;
        }
        setStatus($("#resultStatus"), "AIが見解を書いています…");
      }
    }
    setStatus($("#resultStatus"), "");
  } catch (e) {
    setStatus($("#resultStatus"), e.message || String(e), true);
  } finally {
    state.aiRunning = false;
    state._scrolled = false;
    btn.disabled = false;
    btn.textContent = state.ai ? "AIの見解を作り直す" : "AIの見解を作成";
    renderReport();
    saveHistory();
  }
}

// ---------- 条件の手入力 ----------
function fillManualForm() {
  for (const el of $("#manualForm").elements) {
    if (!el.name) continue;
    const v = state.manual[el.name];
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = v ?? "";
  }
  $("#aiBtn").textContent = state.ai ? "AIの見解を作り直す" : "AIの見解を作成";
}

$("#manualForm").addEventListener("input", () => {
  const m = {};
  for (const el of $("#manualForm").elements) {
    if (!el.name) continue;
    const v = el.type === "checkbox" ? el.checked : el.value;
    if (v === "" || v === false) continue;
    m[el.name] = v;
  }
  state.manual = m;
  renderReport();
  saveHistory();
});

// ---------- 写真（この端末の中だけで縮小して使う） ----------
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error(`${file.name} を読み込めませんでした（HEICは端末側でJPEGに変換してください）`));
    img.src = URL.createObjectURL(file);
  });
}

$("#photoInput").addEventListener("change", async (e) => {
  for (const file of [...e.target.files].slice(0, 8)) {
    try {
      state.photos.push({ src: await shrink(file), caption: file.name.replace(/\.[^.]+$/, "") });
    } catch (err) {
      setStatus($("#resultStatus"), err.message, true);
    }
  }
  e.target.value = "";
  renderPhotos();
  renderReport();
});

function renderPhotos() {
  $("#photoList").innerHTML = state.photos
    .map((p, i) => `<li><img src="${p.src}" alt=""><input data-i="${i}" value="${esc(p.caption)}" aria-label="写真の説明"><button type="button" data-del="${i}" aria-label="削除">×</button></li>`)
    .join("");
}
$("#photoList").addEventListener("input", (e) => {
  const i = e.target.dataset.i;
  if (i == null) return;
  state.photos[Number(i)].caption = e.target.value;
  renderReport();
});
$("#photoList").addEventListener("click", (e) => {
  const i = e.target.dataset.del;
  if (i == null) return;
  state.photos.splice(Number(i), 1);
  renderPhotos();
  renderReport();
});

// ---------- 履歴 ----------
function openHistory() {
  const list = store.get("tochishirabe.history", []);
  $("#historyList").innerHTML = list.length
    ? list.map((x, i) => `<li><button type="button" data-i="${i}">${esc(x.address)}<small>${new Date(x.date).toLocaleString("ja-JP")}${x.ai ? "・AI見解あり" : ""}</small></button></li>`).join("")
    : `<li class="hint">まだありません。調べた土地はこの端末に保存されます。</li>`;
  $("#historyList").onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const x = list[Number(b.dataset.i)];
    Object.assign(state, { survey: x.survey, manual: x.manual || {}, ai: x.ai || "", photos: [], id: x.id });
    $("#address").value = x.address;
    fillManualForm();
    renderPhotos();
    renderReport();
    setStatus($("#resultStatus"), "");
    show("result");
    $("#historyDialog").close();
  };
  $("#historyDialog").showModal();
}

// ---------- イベント ----------
const fail = (el) => (e) => {
  console.error(e);
  setStatus(el, e.message || String(e), true);
};

$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  search($("#address").value.trim()).catch(fail($("#homeStatus")));
});
$("#locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return fail($("#homeStatus"))(new Error("この端末では位置情報が使えません"));
  setStatus($("#homeStatus"), "現在地を取得しています…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setStatus($("#homeStatus"), "");
      state.candidates = [];
      openLocate(pos.coords.latitude, pos.coords.longitude, "現在地");
    },
    (err) => fail($("#homeStatus"))(new Error(`現在地を取得できませんでした（${err.message}）`)),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});
$("#confirmBtn").addEventListener("click", () => {
  if (!pending) return;
  const title = pending.title === "現在地" ? "" : pending.title;
  runSurvey({ ...pending, title }).catch((e) => {
    show("locate");
    fail($("#pinInfo"))(e);
  });
});
$("#backBtn").addEventListener("click", () => show("home"));
$("#newBtn").addEventListener("click", () => {
  show("home");
  $("#address").focus();
});
$("#printBtn").addEventListener("click", () => window.print());
$("#aiBtn").addEventListener("click", generateAi);
$("#reportPages").addEventListener("click", (e) => {
  if (e.target.closest("[data-action=ai]")) generateAi();
});
$("#historyBtn").addEventListener("click", openHistory);

// スマホでは入力欄を閉じた状態から始める
if (matchMedia("(max-width: 900px)").matches) for (const d of document.querySelectorAll(".panel-box")) d.open = false;

// 印刷時のファイル名（多くのブラウザは title を既定のファイル名に使う）
window.addEventListener("beforeprint", () => {
  if (state.survey) document.title = `土地調査レポート_${state.survey.address}`;
});
window.addEventListener("afterprint", () => (document.title = "土地しらべ｜住所から家づくりの土地条件レポート"));
