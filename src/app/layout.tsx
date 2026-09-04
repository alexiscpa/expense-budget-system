import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "部門費用預算編列系統",
  description: "企業年度費用預算編列與審核系統",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
