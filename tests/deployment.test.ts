import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");

describe("deployment configuration - no migration/seed at Vercel build time", () => {
  it("the build script only runs `next build` - no prisma migrate / seed step", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.scripts.build).not.toMatch(/migrate/);
    expect(pkg.scripts.build).not.toMatch(/seed/);
    // postinstall may run `prisma generate` (schema-only, no DB access) but
    // must never run migrate/seed either.
    expect(pkg.scripts.postinstall ?? "").not.toMatch(/migrate|seed/);
  });

  it("prisma schema declares both a pooled url and a direct migration url", () => {
    const schema = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf-8");
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
    expect(schema).toMatch(/directUrl\s*=\s*env\("DIRECT_URL"\)/);
  });
});

describe("GitHub Actions migration workflow", () => {
  const workflowPath = path.join(root, ".github", "workflows", "migrate.yml");
  const source = fs.readFileSync(workflowPath, "utf-8");

  it("is manually triggered only (workflow_dispatch), never on push/schedule", () => {
    expect(source).toMatch(/workflow_dispatch:/);
    expect(source).not.toMatch(/^\s*schedule:/m);
    expect(source).not.toMatch(/^\s*push:/m);
  });

  it("runs `prisma migrate deploy` against environment-scoped secrets", () => {
    expect(source).toMatch(/npx prisma migrate deploy/);
    expect(source).toMatch(/secrets\.DATABASE_URL/);
    expect(source).toMatch(/secrets\.DIRECT_URL/);
    expect(source).toMatch(/environment:\s*\$\{\{\s*inputs\.environment\s*\}\}/);
  });
});
