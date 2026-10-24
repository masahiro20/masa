import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import type { EvaluatedListing, HazardLayerKey } from '../../shared/types';
import { formatManYen } from '../../shared/units';
import type { Meta } from '../api';
import { Icon, RANK_SHORT } from '../ui';

const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a> / <a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>';

/** 地図上で切り替えられるハザードレイヤー */
export const OVERLAY_OPTIONS: { key: HazardLayerKey; label: string }[] = [
  { key: 'flood', label: '洪水' },
  { key: 'stormSurge', label: '高潮' },
  { key: 'tsunami', label: '津波' },
  { key: 'steepSlope', label: '急傾斜地' },
  { key: 'debrisFlow', label: '土石流' },
  { key: 'landslide', label: '地すべり' },
];

interface Props {
  items: EvaluatedListing[];
  meta: Meta;
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  /** 詳細画面用：1物件にズームし、ハザードレイヤーを初期表示 */
  single?: boolean;
  initialOverlays?: HazardLayerKey[];
  className?: string;
}

function markerIcon(item: EvaluatedListing, active: boolean) {
  return L.divIcon({
    className: '',
    html: `<div class="map-marker rank-${item.rank}${active ? ' active' : ''}"><span>${RANK_SHORT[item.rank]}</span></div>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
    popupAnchor: [0, -32],
  });
}

export function MapView({ items, meta, selectedId, hoveredId, onSelect, single, initialOverlays, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; item: EvaluatedListing }>());
  const overlayLayers = useRef(new Map<HazardLayerKey, L.TileLayer>());
  const fittedKey = useRef('');
  const [overlays, setOverlays] = useState<HazardLayerKey[]>(initialOverlays ?? []);
  const [opacity, setOpacity] = useState(0.65);

  // 地図の初期化
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: true, attributionControl: true }).setView([35.68, 139.7], 10);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { attribution: GSI_ATTR, maxZoom: 18 }).addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      markers.current.clear();
      overlayLayers.current.clear();
      fittedKey.current = '';
    };
  }, []);

  // マーカーの更新
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const { marker } of markers.current.values()) marker.remove();
    markers.current.clear();
    const pts: L.LatLngExpression[] = [];
    for (const item of items) {
      const { lat, lng } = item.listing;
      if (lat == null || lng == null) continue;
      const marker = L.marker([lat, lng], { icon: markerIcon(item, item.listing.id === selectedId), riseOnHover: true })
        .addTo(m)
        .bindTooltip(`<strong>${item.listing.title}</strong><br>${formatManYen(item.listing.price)}・${item.derived.tsubo}坪`, { direction: 'top', offset: [0, -30] });
      if (onSelect) marker.on('click', () => onSelect(item.listing.id));
      markers.current.set(item.listing.id, { marker, item });
      pts.push([lat, lng]);
    }
    // 表示物件の顔ぶれが変わったときだけ表示範囲を合わせる（再評価のたびに利用者のズームを崩さない）
    const key = [...markers.current.keys()].sort().join(',');
    if (key !== fittedKey.current) {
      fittedKey.current = key;
      if (single && pts.length === 1) m.setView(pts[0], 15);
      else if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, single]);

  // 選択・ホバーの強調
  useEffect(() => {
    for (const [id, { marker, item }] of markers.current) {
      const active = id === selectedId || id === hoveredId;
      marker.setIcon(markerIcon(item, active));
      marker.setZIndexOffset(active ? 1000 : 0);
    }
    const target = hoveredId ?? selectedId;
    const hit = target ? markers.current.get(target) : undefined;
    if (hit && map.current && !single && selectedId === target) map.current.panTo(hit.marker.getLatLng(), { animate: true });
  }, [selectedId, hoveredId, single]);

  // ハザードレイヤー
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const [key, layer] of overlayLayers.current) {
      if (!overlays.includes(key)) {
        layer.remove();
        overlayLayers.current.delete(key);
      }
    }
    for (const key of overlays) {
      const def = meta.hazardLayers.find((h) => h.key === key);
      if (!def || overlayLayers.current.has(key)) continue;
      const layer = L.tileLayer(def.url, { opacity, maxNativeZoom: 17, maxZoom: 18, attribution: GSI_ATTR }).addTo(m);
      overlayLayers.current.set(key, layer);
    }
    for (const layer of overlayLayers.current.values()) layer.setOpacity(opacity);
  }, [overlays, opacity, meta.hazardLayers]);

  const toggle = (k: HazardLayerKey) => setOverlays((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  return (
    <div className={`map-wrap ${className ?? ''}`}>
      <div ref={el} className="map" />
      <div className="map-overlay-ctrl">
        <div className="map-ctrl-title">
          <Icon name="layers" size={14} />
          ハザード表示
        </div>
        <div className="map-ctrl-chips">
          {OVERLAY_OPTIONS.map((o) => (
            <button key={o.key} type="button" className={`chip chip-sm ${overlays.includes(o.key) ? 'chip-on' : ''}`} onClick={() => toggle(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
        {overlays.length > 0 && (
          <label className="opacity-ctrl">
            透過
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
        )}
      </div>
      {!single && (
        <div className="map-legend">
          <span><i className="dot rank-high" />高</span>
          <span><i className="dot rank-medium" />中</span>
          <span><i className="dot rank-low" />低</span>
          <span><i className="dot rank-out" />対象外</span>
        </div>
      )}
    </div>
  );
}
