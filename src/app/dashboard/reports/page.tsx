import { ReportsClient } from "./ReportsClient";

// A protected /dashboard page, exactly like its siblings (see
// dashboard/page.tsx, dashboard/budgets/[id]/page.tsx) - never a candidate
// for static generation. Thin server-component wrapper (matches
// app/login/page.tsx's own LoginForm split) so this route's static-shell
// generation never touches a "use client" default export directly.
export const dynamic = "force-dynamic";

export default function ReportsPage() {
  return <ReportsClient />;
}
