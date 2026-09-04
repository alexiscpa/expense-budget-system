import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { previewDepartmentImport, commitDepartmentImport, hashFileBuffer } from "@/lib/importing/masterDataImport";
import { assertSameOrigin } from "@/lib/security/csrf";

/**
 * multipart/form-data with fields: file (xlsx/csv rows as JSON), mode
 * ("preview" | "commit"). Kept as JSON-row upload (rather than parsing xlsx
 * server-side here) so preview/commit share identical validation - the
 * Excel parsing for this entity type mirrors src/lib/excel/importBudgetLines.ts
 * and can be added the same way when a concrete template file is supplied.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const rows: unknown[] = body.rows ?? [];
    const mode: "preview" | "commit" = body.mode ?? "preview";
    const fileName: string = body.fileName ?? "departments.json";

    const preview = previewDepartmentImport(rows);
    if (mode === "preview") {
      return NextResponse.json({ preview });
    }

    if (preview.errors.length > 0) {
      return NextResponse.json({ error: "檔案含有錯誤，請先修正後再匯入", preview }, { status: 422 });
    }

    const fileHash = hashFileBuffer(Buffer.from(JSON.stringify(rows)));
    const batch = await commitDepartmentImport(user, { fileName, fileHash }, preview.validRows as never);
    return NextResponse.json({ batch });
  } catch (err) {
    return errorResponse(err);
  }
}
