import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { createMemoryEntry, listMemoryEntries } from "@/lib/memory/service";
import { memoryCreateSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const entries = await listMemoryEntries(user, {
      type: (searchParams.get("type") as never) ?? undefined,
      scopeDepartmentId: searchParams.get("departmentId") ?? undefined,
      fiscalYear: searchParams.get("fiscalYear") ? Number(searchParams.get("fiscalYear")) : undefined,
    });
    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = memoryCreateSchema.parse(body);
    const entry = await createMemoryEntry(user, {
      type: parsed.type,
      scopeDepartmentId: parsed.scopeDepartmentId,
      fiscalYear: parsed.fiscalYear,
      source: `user:${user.id}`,
      payload: parsed.payload,
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
