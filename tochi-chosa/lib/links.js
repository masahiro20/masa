// 住所に応じた確認先リンク。自治体ごとのURLは変わりやすいので、検索リンクで確実にたどれるようにする

const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

export function buildLinks({ lat, lon, pref, city }) {
  const where = `${pref}${city}`;
  return [
    {
      group: "現地・地図",
      items: [
        { label: "Googleマップ", url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` },
        { label: "ストリートビュー（道路幅・電柱・桝の確認）", url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}` },
        { label: "地理院地図（地形・標高）", url: `https://maps.gsi.go.jp/#18/${lat}/${lon}/` },
        { label: "重ねるハザードマップ", url: `https://disaportal.gsi.go.jp/maps/?ll=${lat},${lon}&z=16&base=pale&vs=c1j0l0u0` },
      ],
    },
    {
      group: `${where || "市町村"}で確認`,
      items: [
        { label: "指定道路図・道路種別", url: g(`${where} 指定道路図 建築基準法 道路 閲覧`) },
        { label: "都市計画図（高度地区・日影規制）", url: g(`${where} 都市計画情報 高度地区 日影規制`) },
        { label: "地区計画・建築協定", url: g(`${where} 地区計画 建築協定 一覧`) },
        { label: "下水道台帳（本管・公共桝）", url: g(`${where} 下水道台帳 閲覧 インターネット`) },
        { label: "水道配管図（配水管・給水管）", url: g(`${where} 水道 配管図 閲覧 給水装置`) },
        { label: "埋蔵文化財包蔵地", url: g(`${pref} 埋蔵文化財包蔵地 地図 ${city}`) },
        { label: "盛土規制法の規制区域", url: g(`${pref} 盛土規制法 規制区域 ${city}`) },
        { label: "景観計画・屋外広告物", url: g(`${where} 景観計画 届出 住宅`) },
      ],
    },
    {
      group: "全国共通の確認先",
      items: [
        { label: "ガス埋設管（東邦ガス等）", url: g(`${where} 都市ガス 供給区域 ガス管 埋設 照会`) },
        { label: "eMAFF農地ナビ（農地かどうか）", url: "https://map.maff.go.jp/" },
        { label: "文化財総覧WebGIS", url: "https://heritagemap.nabunken.go.jp/" },
        { label: "全国地価マップ（路線価・固定資産税路線価）", url: "https://www.chikamap.jp/" },
        { label: "不動産情報ライブラリ（地図）", url: "https://www.reinfolib.mlit.go.jp/map/" },
      ],
    },
  ];
}
