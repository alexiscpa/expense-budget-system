import Link from "next/link";
import { isAuthBypassEnabled } from "@/lib/env";
import { LoginForm } from "./LoginForm";

// Renders a different screen entirely depending on the request-time
// isAuthBypassEnabled() check - never a candidate for static generation.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Test-only bypass: show a clear notice instead of the credential form.
  // See lib/env.ts#isAuthBypassEnabled for the fail-closed, Preview-only
  // rules governing when this can ever be true (Production is always
  // excluded, regardless of AUTH_DISABLED).
  if (isAuthBypassEnabled()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">目前已啟用 Demo 測試環境免登入模式</h1>
        <p className="text-sm text-slate-600">
          此 Preview 部署為功能測試環境，已略過登入步驟。所有操作皆以「測試管理員」虛擬身分執行，
          不會使用任何真實帳號密碼，相關稽核紀錄會標記為 TEST_BYPASS_USER。正式環境（Production）
          恆維持原本登入保護，不受此設定影響。
        </p>
        <Link
          href="/"
          className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
        >
          返回首頁
        </Link>
      </main>
    );
  }

  return <LoginForm />;
}
