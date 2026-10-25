"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { icons, type IconName } from "./icons";

export function EzButton({
  icon,
  label,
  onClick,
  disabled,
  small,
  wide,
  dark,
  ghost,
  title,
  type = "button",
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
  wide?: boolean;
  dark?: boolean;
  ghost?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const cls = ["ez-btn", small && "small", wide && "wide", dark && "dark", ghost && "ghost"].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      <span className="ez-ico">{icons[icon]}</span>
      <span className="label">{label}</span>
    </button>
  );
}

export function DeleteX({ onClick, title = "削除" }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" className="ez-x" onClick={onClick} title={title} aria-label={title}>
      {icons.x}
    </button>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ez-sec">
      <div className="ez-sec-head" onClick={() => setOpen((o) => !o)}>
        <span className="ez-ico">{open ? icons.minus : icons.plus}</span>
        {title}
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="ez-sec-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, stack }: { label: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`ez-row${stack ? " stack" : ""}`}>
      <div className="k">{label}</div>
      <div>{children}</div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
        <div className="modal-head">
          {title}
          <span className="spacer" />
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const MENU = [
  { href: "/", label: "物件一覧" },
  { href: "/?new=1", label: "新規作成" },
  { href: "/?new=auto", label: "図面から一発計算" },
  { href: "/?sample=1", label: "サンプル物件を開く" },
];

/** 画面の外枠：黒帯・左端の Menu タブ・オレンジのプログラム帯 */
export function AppFrame({
  title,
  icon = "house",
  headerRight,
  children,
}: {
  title: string;
  icon?: "house" | "list";
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <>
      <div className="no-print">
        <button className="ez-menu-tab" onClick={() => setMenu(true)} aria-label="メニューを開く">
          ▶Menu
        </button>
        {menu && (
          <>
            <div className="ez-drawer-backdrop" onClick={() => setMenu(false)} />
            <nav className="ez-drawer">
              <h3>外皮計算</h3>
              {MENU.map((m) => (
                <Link key={m.href} href={m.href} onClick={() => setMenu(false)}>
                  {m.label}
                </Link>
              ))}
              <h3>プログラム</h3>
              <span className="current" style={{ display: "block", padding: "10px 20px" }}>
                外皮性能計算プログラム
              </span>
            </nav>
          </>
        )}
        <div className="ez-top">
          外皮計算ツール
          <span className="ez-top-right">
            <span className="dot" />
            ホームランディック
          </span>
        </div>
        <div className="ez-program">
          <span className="ez-program-icon">{icons[icon]}</span>
          <h1>{title}</h1>
          <span className="spacer" />
          {headerRight}
        </div>
      </div>
      {children}
    </>
  );
}
