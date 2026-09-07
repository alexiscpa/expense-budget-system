import type { Metadata } from "next";
import "./globals.css";
import { isAuthBypassEnabled } from "@/lib/env";

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
  // Rendered on every page (including /login) whenever the test-only
  // Preview bypass is active, so it is never possible to miss - see
  // lib/env.ts#isAuthBypassEnabled for the fail-closed, Preview-only rules.
  const bypassActive = isAuthBypassEnabled();

  return (
    <html lang="zh-Hant">
      <body>
        {bypassActive && (
          <div
            role="alert"
            className="sticky top-0 z-50 w-full bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white"
          >
            Demo 測試環境，禁止輸入正式資料
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
