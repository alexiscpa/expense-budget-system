import { DashboardNavProvider } from "./DashboardNavContext";
import { DashboardNav } from "./DashboardNav";

/**
 * Shared shell for every /dashboard/** route: a single "← 回到預算總覽"
 * bar + breadcrumb (see DashboardNav.tsx), so navigation back to the
 * budget overview is built once here instead of copied into each page.
 * Individual pages customize the breadcrumb's trailing label and, where a
 * page has its own save-before-navigate logic, the button's behavior - via
 * DashboardNavContext.tsx's hooks - rather than rendering a second bar.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardNavProvider>
      <DashboardNav />
      {children}
    </DashboardNavProvider>
  );
}
