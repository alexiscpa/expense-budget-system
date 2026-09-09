import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { staticCrumbForPath } from "@/app/dashboard/DashboardNav";

describe("staticCrumbForPath - breadcrumb label for routes whose title never depends on server data", () => {
  it("returns the fixed label for the summary preview page", () => {
    expect(staticCrumbForPath("/dashboard/reports/budget-summary-preview")).toBe("費用預算彙總表（版型預覽）");
  });

  it("returns the fixed label for the reports index page", () => {
    expect(staticCrumbForPath("/dashboard/reports")).toBe("報表");
  });

  it("returns null for the dashboard home itself (no trailing crumb needed)", () => {
    expect(staticCrumbForPath("/dashboard")).toBeNull();
  });

  it("returns null for the dynamic budget version route - that page supplies its own trailing crumb once it has loaded department/version data", () => {
    expect(staticCrumbForPath("/dashboard/budgets/some-version-id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route inventory - a plain filesystem walk (no Next.js runtime needed) so
// this test fails loudly the moment a new /dashboard/** route is added
// without being accounted for here, catching the exact "forgot to give a
// new page a way back" failure mode this whole round exists to close.
// Every one of these routes is automatically wrapped by
// src/app/dashboard/layout.tsx (a real Next.js convention, not something
// this test can execute) - see the browser acceptance report for the
// actual rendered proof; this test's job is only to keep the known route
// list honest as pages are added or removed.
// ---------------------------------------------------------------------------

const DASHBOARD_DIR = join(__dirname, "..", "src", "app", "dashboard");

function findPageRoutes(dir: string, base = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      routes.push(...findPageRoutes(full, `${base}/${entry}`));
    } else if (entry === "page.tsx") {
      routes.push(base === "" ? "/dashboard" : `/dashboard${base}`);
    }
  }
  return routes;
}

describe("Dashboard route inventory", () => {
  it("matches the exact known set of /dashboard/** page routes - update this list (and DashboardNav's staticCrumbForPath / the target page's useDashboardBreadcrumb) when adding a new one", () => {
    const routes = findPageRoutes(DASHBOARD_DIR).sort();
    expect(routes).toEqual(
      ["/dashboard", "/dashboard/budgets/[id]", "/dashboard/reports", "/dashboard/reports/budget-summary-preview"].sort()
    );
  });

  it("dashboard/layout.tsx exists and wires up the shared nav provider + bar - the mechanism that makes every route above (and any future one) automatically get a back entry with zero per-page copy-paste", () => {
    const layoutSource = readFileSync(join(DASHBOARD_DIR, "layout.tsx"), "utf-8");
    expect(layoutSource).toContain("DashboardNavProvider");
    expect(layoutSource).toContain("DashboardNav");
  });

  it("a dashboard-scoped not-found.tsx exists, so an invalid route/id inside /dashboard shows a 回到預算總覽／回到登入頁 exit rather than the generic root 回首頁 one", () => {
    const notFoundSource = readFileSync(join(DASHBOARD_DIR, "not-found.tsx"), "utf-8");
    expect(notFoundSource).toContain("回到預算總覽");
    expect(notFoundSource).toContain("回到登入頁");
  });
});

describe("Excel/PDF export never includes the web navigation bar", () => {
  it("the Excel and PDF builders behind the export API route have zero dependency on the dashboard nav components (they are pure data->file builders, never a page render)", () => {
    const excelSource = readFileSync(
      join(__dirname, "..", "src", "lib", "excel", "budgetSummaryPreviewExport.ts"),
      "utf-8"
    );
    const pdfSource = readFileSync(join(__dirname, "..", "src", "lib", "pdf", "budgetSummaryPreviewPdf.ts"), "utf-8");
    for (const source of [excelSource, pdfSource]) {
      expect(source).not.toContain("DashboardNav");
      expect(source).not.toContain("回到預算總覽");
      expect(source.includes("next/navigation")).toBe(false);
    }
  });
});
