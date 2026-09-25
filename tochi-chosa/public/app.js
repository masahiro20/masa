import { deriveFindings } from "./shared/rules.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LEVEL_LABEL = { info: "OK", warn: "注意", danger: "重大", check: "要確認", none: "未取得", ref: "参考" };
const badge = (level) => `<span class="badge lv-${level === "ref" ? "info" : level}">${LEVEL_LABEL[level]}</span>`;

const state = { survey: null, manual: {}, ai: "", historyId: null };

// ---------- 保存（この端末の localStorage。使えない環境でも動くように） ----------
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
      /* 容量超過・プライベートモードなどは無視 */
    }
  },
};

function saveHistory() {
  if (!state.survey) return;
  const list = store.get("tochi.history", []);
  const entry = {
    id: state.historyId,
    address: state.survey.address,
    date: new Date().toISOString(),
    survey: state.survey,
    manual: state.manual,
    ai: state.ai,
  };
  const i = list.findIndex((h) => h.id === state.historyId);
  if (i >= 0) list.splice(i, 1);
  list.unshift(entry);
  store.set("tochi.history", list.slice(0, 20));
}

// ---------- API ----------
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const code = store.get("tochi.passcode", "");
  if (code) headers["x-app-passcode"] = code;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    const input = prompt("合言葉を入力してください");
    if (input == null) throw new Error("合言葉が必要です");
    store.set("tochi.passcode", input);
    return api(url, options);
  }
  return res;
}

function setStatus(text, isError = false) {
  const el = $("#status");
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("error", isError);
}

// ---------- 地図 ----------
let map, marker, floodLayer;
function ensureMap() {
  if (map) return true;
  if (!window.L) return false; // 地図ライブラリが読めなくても調査自体は続ける
  $("#mapCard").hidden = false;
  map = L.map("map", { zoomControl: true }).setView([35.18, 136.9], 16);
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxZoom: 19,
    maxNativeZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
  }).addTo(map);
  floodLayer = L.tileLayer("https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png", {
    opacity: 0.6,
    maxZoom: 19,
    maxNativeZoom: 17,
    attribution: "洪水浸水想定：ハザードマップポータルサイト",
  });
  marker = L.marker([35.18, 136.9], { draggable: true }).addTo(map);
  const moved = () => ($("#resurveyBtn").hidden = false);
  marker.on("dragend", moved);
  map.on("click", (e) => {
    marker.setLatLng(e.latlng);
    moved();
  });
  return true;
}

function placeMarker(lat, lon) {
  if (!ensureMap()) return;
  marker.setLatLng([lat, lon]);
  map.setView([lat, lon], 17);
  $("#resurveyBtn").hidden = true;
  setTimeout(() => map.invalidateSize(), 50);
}

// ---------- 検索・調査 ----------
async function search(q) {
  setStatus("住所を検索しています…");
  $("#candidates").hidden = true;
  const res = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "住所検索に失敗しました");
  const list = data.candidates || [];
  if (!list.length) throw new Error("住所が見つかりませんでした。番地を省く・表記を変えるなどして再検索してください。");
  if (list.length > 1) {
    $("#candidates").innerHTML =
      `<li class="hint" style="padding:6px 0 0">候補（別の地点ならタップ）</li>` +
      list.map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.title)}</button></li>`).join("");
    $("#candidates").hidden = false;
    $("#candidates").onclick = (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      const c = list[Number(b.dataset.i)];
      runSurvey(c.lat, c.lon, c.title).catch(showError);
    };
  }
  await runSurvey(list[0].lat, list[0].lon, list[0].title);
}

async function runSurvey(lat, lon, address) {
  placeMarker(lat, lon);
  setStatus("法令・ハザード情報を取得しています…（10秒ほどかかります）");
  const res = await api("/api/survey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, address }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "調査に失敗しました");
  state.survey = data;
  state.manual = {};
  state.ai = "";
  state.historyId = `${Date.now()}`;
  fillManualForm();
  renderAll();
  resetAi();
  saveHistory();
  setStatus("");
}

function showError(e) {
  console.error(e);
  setStatus(e.message || String(e), true);
}

// ---------- 描画 ----------
const MUST = [
  { label: "用途地域", keys: ["useZone"] },
  { label: "建蔽率", keys: ["bcr"] },
  { label: "容積率", keys: ["far"] },
  { label: "高さ制限", keys: ["height"] },
  { label: "壁面後退", keys: ["wallSetback"] },
  { label: "前面道路の種別", keys: ["roadType"] },
  { label: "幅員", keys: ["roadWidth", "setback", "frontage"], empty: "未確認（現地計測または道路台帳で確認し、下の入力欄に記入）" },
  { label: "防火地域", keys: ["fire"] },
  { label: "上水道", keys: ["water"] },
  { label: "下水道", keys: ["sewer"] },
  { label: "ガス", keys: ["gas"] },
];
const HAZARD_KEY = (k) => k.startsWith("hz_") || k.startsWith("rf_") || k === "liquefaction";
const ORDER = ["danger", "warn", "check", "info", "none"];
const worst = (items) => ORDER.find((lv) => items.some((f) => f.level === lv)) || "info";

function row(label, items, emptyText) {
  if (!items.length) {
    return `<div class="row"><dt>${esc(label)}</dt><dd>${badge(emptyText ? "check" : "none")}${esc(emptyText || "未取得")}</dd></div>`;
  }
  const body = items
    .map((f) => `${esc(f.value)}${f.note ? `<span class="note">${esc(f.note)}</span>` : ""}`)
    .join("<br>");
  return `<div class="row"><dt>${esc(label)}</dt><dd>${badge(worst(items))}${body}</dd></div>`;
}

function renderAll() {
  const s = state.survey;
  if (!s) return;
  const { findings } = deriveFindings({ reinfo: s.reinfo, hazards: s.hazards, manual: state.manual, city: s.city });
  state.findings = findings;
  const byKey = (k) => findings.filter((f) => f.key === k);

  $("#report").hidden = false;
  $("#keyNotice").hidden = s.hasReinfoKey;
  $("#placeInfo").textContent =
    `${s.address}（${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}）` +
    (s.elevation ? ` 標高 約${s.elevation.elevation}m` : "");
  $("#fetchedAt").textContent = `取得日時：${new Date(s.fetchedAt).toLocaleString("ja-JP")}`;

  // 必須項目
  const mustRows = MUST.map((m) => row(m.label, m.keys.flatMap(byKey), m.empty));
  // 注意以上のハザードだけを並べ、「液状化しにくい」などの情報は補足に回す
  const hzAll = findings.filter((f) => HAZARD_KEY(f.key));
  const hz = hzAll.filter((f) => f.level !== "info");
  const hzInfo = hzAll.filter((f) => f.level === "info").map((f) => `${f.label}：${f.value}`);
  mustRows.push(
    hz.length
      ? row("ハザード", [...hz.map((f) => ({ ...f, value: `${f.label}：${f.value}` })), ...hzInfo.map((v) => ({ level: "info", value: v }))])
      : `<div class="row"><dt>ハザード</dt><dd>${badge("info")}洪水・高潮・津波・土砂災害の想定区域に該当なし（地点）<span class="note">${esc([...hzInfo, "内水氾濫・ため池は市町村のハザードマップで確認"].join("。"))}</span></dd></div>`
  );
  $("#mustList").innerHTML = mustRows.join("");

  // ハザード詳細
  const reinfoHazardIds = ["floodVector", "sediment", "disasterZone", "steepSlopeArea", "landslideArea", "embankment", "liquefaction"];
  const hazardItems = [
    ...s.hazards.map((h) => {
      if (h.status !== "ok") return `<li>${badge("none")}${esc(h.name)}：取得失敗 <span class="src">${esc(h.error || "")}</span></li>`;
      const lv = h.atPoint ? (/特別|^(3\.0|5\.0|10|20)/.test(h.atPoint) ? "danger" : "warn") : h.nearby ? "check" : "info";
      const text = h.atPoint ? h.atPoint : h.nearby ? `地点外（周辺約20m以内に ${h.nearby}）` : "区域外";
      return `<li>${badge(lv)}${esc(h.name)}：${esc(text)} <span class="src">${esc(h.source)}</span></li>`;
    }),
    ...s.reinfo
      .filter((r) => reinfoHazardIds.includes(r.id))
      .map((r) => {
        if (r.status === "nokey") return `<li>${badge("none")}${esc(r.name)}：APIキー未設定</li>`;
        if (r.status !== "ok") return `<li>${badge("none")}${esc(r.name)}：取得失敗</li>`;
        if (!r.hits.length) return `<li>${badge("info")}${esc(r.name)}：該当なし <span class="src">${esc(r.source)}</span></li>`;
        return `<li>${badge(r.id === "liquefaction" ? "info" : "warn")}${esc(r.name)}：${r.hits.map(fmtHit).join(" ／ ")} <span class="src">${esc(r.source)}</span></li>`;
      }),
  ];
  $("#hazardList").innerHTML = hazardItems.join("");

  // その他
  const used = new Set([...MUST.flatMap((m) => m.keys)]);
  const others = findings.filter((f) => !used.has(f.key) && !HAZARD_KEY(f.key)).map((f) => row(f.label, [f]));
  const extraIds = ["elementarySchool", "juniorHighSchool", "landPrice"];
  for (const r of s.reinfo.filter((x) => extraIds.includes(x.id) && x.status === "ok" && x.hits?.length)) {
    const text = r.hits.map(fmtHit).join("<br>");
    others.push(`<div class="row"><dt>${esc(r.name)}</dt><dd>${badge("ref")}${text}${r.id === "landPrice" ? '<span class="note">近隣地点の情報であり、対象地そのものではありません</span>' : ""}</dd></div>`);
  }
  $("#otherList").innerHTML = others.join("") || `<p class="hint">追加の該当事項はありません。</p>`;

  // リンク
  $("#links").innerHTML = s.links
    .map(
      (g) =>
        `<h3>${esc(g.group)}</h3><ul>${g.items
          .map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.label)}</a></li>`)
          .join("")}</ul>`
    )
    .join("");
}

function fmtHit(hit) {
  return esc(
    Object.entries(hit)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}：${v === true || v === "true" ? "あり" : v === false || v === "false" ? "なし" : v}`)
      .join("、")
  );
}

// ---------- 手入力 ----------
function fillManualForm() {
  const form = $("#manualForm");
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") el.checked = Boolean(state.manual[el.name]);
    else el.value = state.manual[el.name] ?? "";
  }
}

$("#manualForm").addEventListener("input", () => {
  const form = $("#manualForm");
  const m = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") m[el.name] = el.checked;
    else if (el.value !== "") m[el.name] = el.value;
  }
  state.manual = m;
  renderAll();
  saveHistory();
});

// ---------- AI 見解 ----------
function resetAi() {
  $("#aiOut").innerHTML = state.ai
    ? renderMarkdown(state.ai)
    : `<p class="hint">調査データと上の入力内容をもとに、プランへの影響・要確認事項・お客様への説明ポイントをまとめます。</p>`;
  $("#aiBtn").textContent = state.ai ? "再生成" : "見解を生成";
}

async function generateAi() {
  const btn = $("#aiBtn");
  btn.disabled = true;
  const out = $("#aiOut");
  out.innerHTML = `<p class="hint cursor">AIが調査結果を読んでいます…</p>`;
  let text = "";
  try {
    const s = state.survey;
    const res = await api("/api/insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: s.address, lat: s.lat, lon: s.lon, pref: s.pref, city: s.city,
        elevation: s.elevation, reinfo: s.reinfo, hazards: s.hazards,
        findings: state.findings, manual: state.manual,
      }),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `AI見解の生成に失敗しました（HTTP ${res.status}）`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
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
        if (type === "text") {
          text += data;
          out.innerHTML = renderMarkdown(text) + `<span class="cursor"></span>`;
        } else if (type === "error") {
          throw new Error(data.message);
        }
      }
    }
    state.ai = text;
    saveHistory();
    resetAi();
  } catch (e) {
    out.innerHTML = (text ? renderMarkdown(text) : "") + `<p class="status error">${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// 最低限の Markdown（見出し・箇条書き・番号・太字）
function renderMarkdown(md) {
  const lines = esc(md).split("\n");
  let html = "";
  let list = null;
  const close = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const line of lines) {
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) {
      close();
      html += `<h3>${inline(m[1])}</h3>`;
    } else if ((m = line.match(/^\s*[-*・]\s+(.*)/))) {
      if (list !== "ul") { close(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") { close(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (line.trim()) {
      close();
      html += `<p>${inline(line)}</p>`;
    } else {
      close();
    }
  }
  close();
  return html;
}

// ---------- 履歴 ----------
function openHistory() {
  const list = store.get("tochi.history", []);
  $("#historyList").innerHTML = list.length
    ? list
        .map(
          (h, i) =>
            `<li><button type="button" data-i="${i}">${esc(h.address)}<small>${new Date(h.date).toLocaleString("ja-JP")}${h.ai ? "・AI見解あり" : ""}</small></button></li>`
        )
        .join("")
    : `<li class="hint">まだ履歴はありません。</li>`;
  $("#historyList").onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const h = list[Number(b.dataset.i)];
    state.survey = h.survey;
    state.manual = h.manual || {};
    state.ai = h.ai || "";
    state.historyId = h.id;
    $("#address").value = h.address;
    placeMarker(h.survey.lat, h.survey.lon);
    fillManualForm();
    renderAll();
    resetAi();
    setStatus("");
    $("#historyDialog").close();
  };
  $("#historyDialog").showModal();
}

// ---------- イベント ----------
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  search($("#address").value.trim()).catch(showError);
});

$("#locateBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return showError(new Error("この端末では位置情報が使えません"));
  setStatus("現在地を取得しています…");
  navigator.geolocation.getCurrentPosition(
    (pos) => runSurvey(pos.coords.latitude, pos.coords.longitude, "").catch(showError),
    (err) => showError(new Error(`現在地を取得できませんでした（${err.message}）`)),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

$("#resurveyBtn").addEventListener("click", () => {
  const { lat, lng } = marker.getLatLng();
  runSurvey(lat, lng, "").catch(showError);
});

$("#floodLayer").addEventListener("change", (e) => {
  if (!map) return;
  if (e.target.checked) floodLayer.addTo(map);
  else map.removeLayer(floodLayer);
});

$("#aiBtn").addEventListener("click", generateAi);
$("#printBtn").addEventListener("click", () => window.print());
$("#historyBtn").addEventListener("click", openHistory);
