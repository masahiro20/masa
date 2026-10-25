import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "外皮計算ツール",
  description: "設計図書から外皮面積を自動で拾い、UA・ηAC・ηAH と計算書を一発で出力する外皮計算ツール",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
