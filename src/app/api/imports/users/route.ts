import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { previewUserImport, commitUserImport, hashFileBuffer } from "@/lib/importing/masterDataImport";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const rows: unknown[] = body.rows ?? [];
    const mode: "preview" | "commit" = body.mode ?? "preview";
    const fileName: string = body.fileName ?? "users.json";

    const preview = previewUserImport(rows);
    if (mode === "preview") {
      return NextResponse.json({ preview });
    }

    if (preview.errors.length > 0) {
      return NextResponse.json({ error: "檔案含有錯誤，請先修正後再匯入", preview }, { status: 422 });
    }

    const fileHash = hashFileBuffer(Buffer.from(JSON.stringify(rows)));
    const result = await commitUserImport(user, { fileName, fileHash }, preview.validRows as never);
    // Reset tokens are one-time-viewable here (no email integration yet) -
    // never written to audit logs or server logs.
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
