import { useMemo, useState } from 'react';
import type { CriterionKey, HazardTolerance, Importance, SearchConditions, ZoningGroup } from '../../shared/types';
import { round, SQM_PER_TSUBO } from '../../shared/units';
import type { Meta } from '../api';
import { Icon, IMPORTANCE_LABEL, Segmented, Toggle } from '../ui';

interface Props {
  meta: Meta;
  value: SearchConditions;
  onChange: (c: SearchConditions) => void;
  onSearch: () => void;
  loading: boolean;
  presets: string[];
  onSavePreset: () => void;
  onLoadPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
}

const PRICE_STEPS = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 10000, 15000];
const WALK_OPTIONS = [5, 7, 10, 15, 20];
const ROAD_OPTIONS = [4, 5, 6];

// 重要度を設定できる条件（エリア以外）
const IMPORTANCE_KEYS: CriterionKey[] = ['price', 'landArea', 'walk', 'zoning', 'hazard', 'buildingCondition', 'roadWidth', 'sunlight', 'shape'];

export function SearchPanel({ meta, value: c, onChange, onSearch, loading, presets, onSavePreset, onLoadPreset, onDeletePreset }: Props) {
  const [pref, setPref] = useState(c.areas[0]?.prefecture ?? '東京都');
  const [cityInput, setCityInput] = useState('');
  const [areaUnit, setAreaUnit] = useState<'sqm' | 'tsubo'>('sqm');
  const [showImportance, setShowImportance] = useState(false);

  const set = (patch: Partial<SearchConditions>) => onChange({ ...c, ...patch });
  const importance = { ...meta.defaultImportance, ...c.importance };
  const cities = meta.cities[pref] ?? [];

  const addArea = (prefecture: string, city?: string) => {
    const exists = c.areas.some((a) => a.prefecture === prefecture && a.city === city);
    if (!exists) set({ areas: [...c.areas.filter((a) => !(a.prefecture === prefecture && !a.city && city)), { prefecture, city }] });
  };
  const removeArea = (i: number) => set({ areas: c.areas.filter((_, j) => j !== i) });

  const toUnit = (sqm?: number) => (sqm == null ? '' : areaUnit === 'sqm' ? String(round(sqm, 1)) : String(round(sqm / SQM_PER_TSUBO, 1)));
  const fromUnit = (v: string) => (v === '' ? undefined : areaUnit === 'sqm' ? Number(v) : round(Number(v) * SQM_PER_TSUBO, 2));

  const toggleZoning = (g: ZoningGroup) => {
    const cur = c.zoningGroups ?? [];
    set({ zoningGroups: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] });
  };

  const activeCount = useMemo(
    () =>
      [c.priceMax, c.areaMin, c.walkMax, c.roadWidthMin, c.zoningGroups?.length, c.southFacing, c.regularShape, c.noBuildingCondition].filter(Boolean).length +
      c.areas.length,
    [c],
  );

  return (
    <form
      className="search-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <div className="panel-scroll">
        <section className="field-group">
          <label className="field-label" htmlFor="customer">お客様名・案件名</label>
          <div className="customer-row">
            <input id="customer" className="input" placeholder="例：山田様 新築計画" value={c.customerName ?? ''} onChange={(e) => set({ customerName: e.target.value })} />
            <button type="button" className="icon-btn" title="この条件を保存" onClick={onSavePreset} disabled={!c.customerName}>
              <Icon name="save" />
            </button>
          </div>
          {presets.length > 0 && (
            <div className="preset-list">
              {presets.map((p) => (
                <span key={p} className="preset-chip">
                  <button type="button" onClick={() => onLoadPreset(p)} title="保存した条件を読み込む">{p}</button>
                  <button type="button" className="x" aria-label={`${p}を削除`} onClick={() => onDeletePreset(p)}>×</button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="field-group">
          <div className="field-label">エリア</div>
          <div className="area-picker">
            <select className="input" value={pref} onChange={(e) => setPref(e.target.value)} aria-label="都道府県">
              {meta.prefectures.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addArea(pref)}>
              {pref}全域を追加
            </button>
          </div>
          {cities.length > 0 && (
            <div className="chip-cloud">
              {cities.map((city) => {
                const on = c.areas.some((a) => a.prefecture === pref && a.city === city);
                return (
                  <button type="button" key={city} className={`chip ${on ? 'chip-on' : ''}`} onClick={() => (on ? removeArea(c.areas.findIndex((a) => a.prefecture === pref && a.city === city)) : addArea(pref, city))}>
                    {city}
                  </button>
                );
              })}
            </div>
          )}
          <div className="inline-add">
            <input
              className="input"
              placeholder="市区町村を入力（例：調布市）"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (cityInput.trim()) addArea(pref, cityInput.trim());
                  setCityInput('');
                }
              }}
            />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!cityInput.trim()} onClick={() => { addArea(pref, cityInput.trim()); setCityInput(''); }}>
              追加
            </button>
          </div>
          <div className="selected-areas">
            {c.areas.length === 0 ? (
              <span className="muted small">未指定（すべてのエリアが対象）</span>
            ) : (
              c.areas.map((a, i) => (
                <span key={`${a.prefecture}${a.city}`} className="tag">
                  <Icon name="pin" size={12} />
                  {a.city ? `${a.city}` : `${a.prefecture}全域`}
                  <button type="button" aria-label="削除" onClick={() => removeArea(i)}>×</button>
                </span>
              ))
            )}
          </div>
        </section>

        <section className="field-group">
          <div className="field-label">予算（土地価格）</div>
          <div className="range-row">
            <select className="input" value={c.priceMin ?? ''} onChange={(e) => set({ priceMin: e.target.value ? Number(e.target.value) : undefined })} aria-label="下限">
              <option value="">下限なし</option>
              {PRICE_STEPS.map((p) => (
                <option key={p} value={p}>{p.toLocaleString()}万円</option>
              ))}
            </select>
            <span className="range-sep">〜</span>
            <select className="input" value={c.priceMax ?? ''} onChange={(e) => set({ priceMax: e.target.value ? Number(e.target.value) : undefined })} aria-label="上限">
              <option value="">上限なし</option>
              {PRICE_STEPS.map((p) => (
                <option key={p} value={p}>{p.toLocaleString()}万円</option>
              ))}
            </select>
          </div>
        </section>

        <section className="field-group">
          <div className="field-label with-aside">
            土地面積
            <Segmented size="sm" value={areaUnit} onChange={setAreaUnit} options={[{ value: 'sqm', label: '㎡' }, { value: 'tsubo', label: '坪' }]} ariaLabel="面積の単位" />
          </div>
          <div className="range-row">
            <input className="input" type="number" min={0} step="any" placeholder="下限" value={toUnit(c.areaMin)} onChange={(e) => set({ areaMin: fromUnit(e.target.value) })} aria-label="面積下限" />
            <span className="range-sep">〜</span>
            <input className="input" type="number" min={0} step="any" placeholder="上限" value={toUnit(c.areaMax)} onChange={(e) => set({ areaMax: fromUnit(e.target.value) })} aria-label="面積上限" />
            <span className="unit">{areaUnit === 'sqm' ? '㎡' : '坪'}</span>
          </div>
        </section>

        <div className="two-col">
          <section className="field-group">
            <label className="field-label" htmlFor="walk">駅徒歩</label>
            <select id="walk" className="input" value={c.walkMax ?? ''} onChange={(e) => set({ walkMax: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">指定なし</option>
              {WALK_OPTIONS.map((w) => (
                <option key={w} value={w}>{w}分以内</option>
              ))}
            </select>
          </section>
          <section className="field-group">
            <label className="field-label" htmlFor="road">前面道路</label>
            <select id="road" className="input" value={c.roadWidthMin ?? ''} onChange={(e) => set({ roadWidthMin: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">指定なし</option>
              {ROAD_OPTIONS.map((w) => (
                <option key={w} value={w}>幅員{w}m以上</option>
              ))}
            </select>
          </section>
        </div>

        <section className="field-group">
          <div className="field-label">用途地域</div>
          <div className="check-list">
            {(Object.entries(meta.zoningGroups) as [ZoningGroup, string][]).map(([g, label]) => (
              <label key={g} className="check">
                <input type="checkbox" checked={c.zoningGroups?.includes(g) ?? false} onChange={() => toggleZoning(g)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="field-group">
          <div className="field-label">こだわり条件</div>
          <div className="toggle-list">
            <Toggle checked={!!c.southFacing} onChange={(v) => set({ southFacing: v })} label="南側に接道" hint="日当たり重視" />
            <Toggle checked={!!c.regularShape} onChange={(v) => set({ regularShape: v })} label="整形地" hint="旗竿地・不整形地を避ける" />
            <Toggle checked={!!c.noBuildingCondition} onChange={(v) => set({ noBuildingCondition: v })} label="建築条件なし" hint="施工会社を自由に選ぶ" />
            <Toggle checked={c.excludeUrbanControl !== false} onChange={(v) => set({ excludeUrbanControl: v })} label="市街化調整区域を除外" />
          </div>
        </section>

        <section className="field-group">
          <div className="field-label">災害リスクの許容度</div>
          <Segmented<HazardTolerance>
            value={c.hazardTolerance ?? 'normal'}
            onChange={(v) => set({ hazardTolerance: v })}
            ariaLabel="災害リスクの許容度"
            options={[
              { value: 'strict', label: '厳しめ', title: '浸水0.5m以上・土砂警戒区域などは条件未達' },
              { value: 'normal', label: '標準', title: '浸水3m以上・土砂特別警戒区域・家屋倒壊区域は条件未達' },
              { value: 'any', label: '考慮しない' },
            ]}
          />
          <p className="hint">
            {(c.hazardTolerance ?? 'normal') === 'strict'
              ? '浸水0.5m以上・土砂災害警戒区域などを「満たさない」と判定します'
              : (c.hazardTolerance ?? 'normal') === 'normal'
                ? '浸水3m以上・土砂特別警戒区域・家屋倒壊等氾濫想定区域を「満たさない」と判定します'
                : 'ハザードはランク判定に使いません（詳細画面には表示されます）'}
          </p>
        </section>

        <section className="field-group">
          <button type="button" className="disclosure" aria-expanded={showImportance} onClick={() => setShowImportance(!showImportance)}>
            <Icon name="chevron" size={14} className={showImportance ? 'rot90' : ''} />
            条件ごとの重要度
            <span className="muted small">必須を満たさない物件は「対象外」</span>
          </button>
          {showImportance && (
            <div className="importance-table">
              {IMPORTANCE_KEYS.map((k) => (
                <div key={k} className="importance-row">
                  <span>{meta.criteria[k]}</span>
                  <Segmented<Importance>
                    size="sm"
                    value={importance[k]}
                    onChange={(v) => set({ importance: { ...c.importance, [k]: v } })}
                    ariaLabel={`${meta.criteria[k]}の重要度`}
                    options={(['must', 'want', 'nice'] as Importance[]).map((i) => ({ value: i, label: IMPORTANCE_LABEL[i] }))}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="panel-footer">
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          <Icon name={loading ? 'refresh' : 'search'} className={loading ? 'spin' : ''} />
          {loading ? '検索中…' : `この条件で探す${activeCount ? `（${activeCount}条件）` : ''}`}
        </button>
      </div>
    </form>
  );
}
