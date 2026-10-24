import { useEffect, useRef, useState } from 'react';
import type { Listing } from '../../shared/types';
import { formatManYen, round } from '../../shared/units';
import { api, type CsvResult, type ImportPreview } from '../api';
import { Icon, Segmented } from '../ui';

type Mode = 'url' | 'csv' | 'list';

const CSV_TEMPLATE = [
  '物件名,所在地,価格,土地面積,交通,用途地域,建ぺい率,容積率,接道状況,地目,形状,建築条件,その他制限事項,URL',
  '例）○○町 南道路の整形地,東京都練馬区石神井町4丁目,5380万円,115.7㎡,西武池袋線「石神井公園」徒歩10分,第一種低層住居専用地域,50%,100%,南側 公道 幅員4.0m 間口8.5m,宅地,整形地,なし,第一種高度地区、準防火地域,',
].join('\r\n');

export function ImportDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('url');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="物件の取り込み" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>
            <Icon name="upload" /> 物件を取り込む
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-tabs">
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'url', label: '物件ページのURL' },
              { value: 'csv', label: 'CSVファイル' },
              { value: 'list', label: '取り込み済み一覧' },
            ]}
          />
        </div>
        <div className="modal-body">
          {mode === 'url' && <UrlImport onSaved={onChanged} />}
          {mode === 'csv' && <CsvImport onDone={onChanged} />}
          {mode === 'list' && <ImportedList onChanged={onChanged} />}
        </div>
      </div>
    </div>
  );
}

function UrlImport({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setSaved(false);
    try {
      setPreview(await api.importUrl(url.trim()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const save = async (listing: Listing) => {
    await api.saveListing(listing);
    setSaved(true);
    onSaved();
  };

  return (
    <div className="import-pane">
      <p className="muted">
        SUUMO・LIFULL HOME'S・不動産ジャパン・各社サイトなどの<b>物件詳細ページ</b>のURLを貼り付けると、表の項目（価格・面積・用途地域・接道など）を読み取ります。
      </p>
      <div className="url-row">
        <input className="input" type="url" placeholder="https://suumo.jp/tochi/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && run()} />
        <button type="button" className="btn btn-primary" disabled={!url || loading} onClick={run}>
          {loading ? '読み取り中…' : '読み取る'}
        </button>
      </div>
      <p className="hint">
        1件ずつ担当者が指定して取り込む用途を想定しています。robots.txt で禁止されたページは取得しません。各サイトの利用規約を守ってご利用ください。
      </p>
      {error && <p className="error-text">{error}</p>}
      {preview && !preview.listing && <p className="error-text">必要な項目を読み取れませんでした：{preview.missing.join('、')}（CSVでの取り込みをお試しください）</p>}
      {preview?.listing && <ListingPreview listing={preview.listing} warnings={preview.warnings} saved={saved} onSave={() => save(preview.listing!)} />}
    </div>
  );
}

function ListingPreview({ listing: l, warnings, onSave, saved }: { listing: Listing; warnings: string[]; onSave: () => void; saved: boolean }) {
  const rows: [string, string | undefined][] = [
    ['物件名', l.title],
    ['所在地', `${l.prefecture}${l.city}${l.address}`],
    ['価格', formatManYen(l.price)],
    ['土地面積', `${round(l.landArea, 2)}㎡`],
    ['交通', l.stations.map((s) => `${s.name} ${s.bus ? `バス${s.bus}分 ` : ''}徒歩${s.walk}分`).join(' / ')],
    ['用途地域', l.zoning],
    ['建ぺい率/容積率', l.coverageRatio != null ? `${l.coverageRatio}% / ${l.floorAreaRatio}%` : undefined],
    ['接道', l.roads.map((r) => `${r.direction ?? ''} ${r.width ?? '?'}m ${r.kind ?? ''}`).join(' / ')],
    ['建築条件', l.buildingCondition == null ? undefined : l.buildingCondition ? 'あり' : 'なし'],
    ['その他制限', l.otherRestrictions?.join('、')],
    ['位置', l.lat != null ? `${l.lat.toFixed(5)}, ${l.lng?.toFixed(5)}` : '住所から特定できませんでした'],
  ];
  return (
    <div className="preview">
      <dl className="spec-list compact">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={v ? '' : 'muted'}>{v || '読み取れず'}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && <ul className="bullets small warn-list">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <button type="button" className="btn btn-primary" disabled={saved} onClick={onSave}>
        <Icon name={saved ? 'check' : 'save'} />
        {saved ? '取り込みました' : 'この内容で取り込む'}
      </button>
    </div>
  );
}

function CsvImport({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file?: File) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importCsv(file));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'land-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="import-pane">
      <p className="muted">
        土地バンク形式・各社の物件リスト・手入力の表などのCSVを取り込みます。列名は「所在地／住所」「価格」「土地面積／敷地面積」「交通」「用途地域」「建ぺい率・容積率」「接道状況」などの表記ゆれに対応しています（Shift_JIS・UTF-8どちらも可）。
      </p>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
      >
        <Icon name="upload" size={28} />
        <strong>{loading ? '取り込み中…（住所から位置を検索しています）' : 'CSVファイルをドロップ、またはクリックして選択'}</strong>
        <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
        テンプレートCSVをダウンロード
      </button>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="csv-result">
          <p>
            <b>{result.imported}件</b>を取り込みました（位置特定 {result.geocoded}件）。
          </p>
          {result.errors.length > 0 && (
            <ul className="bullets small error-list">
              {result.errors.slice(0, 10).map((e) => (
                <li key={e.row}>
                  {e.row}行目：{e.message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && <p className="hint">注意 {result.warnings.length}件（交通・接道・用途地域の読み取り漏れなど）</p>}
        </div>
      )}
    </div>
  );
}

function ImportedList({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<Listing[] | null>(null);
  const load = () => api.imported().then((r) => setList(r.listings));
  useEffect(() => {
    load();
  }, []);
  if (!list) return <p className="muted">読み込み中…</p>;
  if (list.length === 0) return <p className="muted">取り込み済みの物件はありません。</p>;
  return (
    <ul className="imported-list">
      {list.map((l) => (
        <li key={l.id}>
          <div>
            <strong>{l.title}</strong>
            <span className="muted small">
              {l.prefecture}
              {l.city}
              {l.address}・{formatManYen(l.price)}・{round(l.landArea, 1)}㎡・{l.sourceLabel}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="削除"
            onClick={async () => {
              await api.removeImported(l.id);
              await load();
              onChanged();
            }}
          >
            <Icon name="trash" />
          </button>
        </li>
      ))}
    </ul>
  );
}
