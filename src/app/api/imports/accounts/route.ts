import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { previewAccountImport, commitAccountImport, hashFileBuffer } from "@/lib/importing/masterDataImport";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const rows: unknown[] = body.rows ?? [];
    const mode: "preview" | "commit" = body.mode ?? "preview";
    const fileName: string = body.fileName ?? "accounts.json";

    const preview = previewAccountImport(rows);
    if (mode === "preview") {
      return NextResponse.json({ preview });
    }

    if (preview.errors.length > 0) {
      return NextResponse.json({ error: "檔案含有錯誤，請先修正後再匯入", preview }, { status: 422 });
    }

    const fileHash = hashFileBuffer(Buffer.from(JSON.stringify(rows)));
    const batch = await commitAccountImport(user, { fileName, fileHash }, preview.validRows as never);
    return NextResponse.json({ batch });
  } catch (err) {
    return errorResponse(err);
  }
}
