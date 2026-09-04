import { NextResponse } from "next/server";
import { requireUser, errorResponse, ApiError } from "@/lib/rbac/guard";
import { parseBudgetLineWorkbook, commitBudgetLineImport } from "@/lib/excel/importBudgetLines";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const formData = await request.formData();
    const file = formData.get("file");
    const mode = String(formData.get("mode") ?? "preview");
    if (!(file instanceof File)) throw new ApiError(400, "缺少上傳檔案");

    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await parseBudgetLineWorkbook(buffer);

    if (!preview.headerMatches) {
      return NextResponse.json(
        {
          error: "這份檔案的欄位結構與標準樣版不同，暫不代入彙整，需要財務確認正確欄位對應後才處理",
          headerFound: preview.headerFound,
        },
        { status: 422 }
      );
    }

    if (mode === "preview") {
      return NextResponse.json({ preview });
    }

    if (preview.errors.length > 0) {
      return NextResponse.json({ error: "檔案含有錯誤，請先修正後再匯入", preview }, { status: 422 });
    }

    const batch = await commitBudgetLineImport(user, params.id, { fileName: file.name, buffer }, preview.validRows);
    return NextResponse.json({ batch });
  } catch (err) {
    return errorResponse(err);
  }
}
