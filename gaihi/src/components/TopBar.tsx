import Link from "next/link";

export function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar no-print">
      <Link href="/" className="brand">
        <span className="brand-mark">外</span>
        外皮計算ツール
      </Link>
      <div className="spacer" />
      {children}
    </header>
  );
}
