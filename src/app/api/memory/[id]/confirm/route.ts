import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { confirmAiSuggestion } from "@/lib/memory/service";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const entry = await confirmAiSuggestion(user, params.id);
    return NextResponse.json({ entry });
  } catch (err) {
    return errorResponse(err);
  }
}
