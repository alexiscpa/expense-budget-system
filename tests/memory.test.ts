import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createMemoryEntry, listMemoryEntries, deleteOwnMemoryEntry, confirmAiSuggestion, overrideAiSuggestion } from "@/lib/memory/service";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

describe("business memory - scope and traceability", () => {
  it("every memory entry records source, creator and timestamp", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(owner.id, dept.id);

    const entry = await createMemoryEntry(toCurrentUser(owner), {
      type: "QUERY_PREFERENCE",
      scopeDepartmentId: dept.id,
      fiscalYear: 2027,
      source: `user:${owner.id}`,
      payload: { filter: "OFFICE" },
    });

    expect(entry.createdById).toBe(owner.id);
    expect(entry.source).toBe(`user:${owner.id}`);
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.scopeDepartmentId).toBe(dept.id);
  });

  it("a department-scoped user cannot read another department's memory entries", async () => {
    const deptA = await createDepartment({ code: `MA${Date.now()}` });
    const deptB = await createDepartment({ code: `MB${Date.now()}` });
    const ownerA = await createUser({ role: "BUDGET_OWNER" });
    const ownerB = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(ownerA.id, deptA.id);
    await grantDepartmentScope(ownerB.id, deptB.id);

    await createMemoryEntry(toCurrentUser(ownerB), {
      type: "QUERY_PREFERENCE",
      scopeDepartmentId: deptB.id,
      fiscalYear: 2027,
      source: `user:${ownerB.id}`,
      payload: { filter: "SENSITIVE" },
    });

    const visibleToA = await listMemoryEntries(toCurrentUser(ownerA), {});
    expect(visibleToA.every((e) => e.scopeDepartmentId !== deptB.id)).toBe(true);
  });

  it("a department-scoped user cannot write a company-wide (unscoped) memory entry", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(owner.id, dept.id);

    await expect(
      createMemoryEntry(toCurrentUser(owner), {
        type: "QUERY_PREFERENCE",
        scopeDepartmentId: null,
        fiscalYear: 2027,
        source: `user:${owner.id}`,
        payload: {},
      })
    ).rejects.toThrow(ApiError);
  });

  it("users may clear their own personal preferences but never audit-required records", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(owner.id, dept.id);

    const preference = await createMemoryEntry(toCurrentUser(owner), {
      type: "QUERY_PREFERENCE",
      scopeDepartmentId: dept.id,
      fiscalYear: null,
      source: `user:${owner.id}`,
      payload: { sortBy: "amount" },
    });
    await deleteOwnMemoryEntry(toCurrentUser(owner), preference.id);
    const afterDelete = await prisma.memoryEntry.findUniqueOrThrow({ where: { id: preference.id } });
    expect(afterDelete.deletedAt).not.toBeNull();

    const returnReason = await prisma.memoryEntry.create({
      data: {
        type: "RETURN_REASON",
        scopeDepartmentId: dept.id,
        fiscalYear: 2027,
        source: "workflow:return:test",
        payload: { reason: "測試" },
        createdById: owner.id,
        isUserDeletable: false,
      },
    });
    await expect(deleteOwnMemoryEntry(toCurrentUser(owner), returnReason.id)).rejects.toThrow(ApiError);
  });

  it("AI-suggested memory must be explicitly confirmed by a human before it is treated as authoritative, and overrides require a reason", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(owner.id, dept.id);

    const suggestion = await createMemoryEntry(toCurrentUser(owner), {
      type: "FIELD_PREFERENCE",
      scopeDepartmentId: dept.id,
      fiscalYear: 2027,
      source: "ai:suggestion-engine",
      payload: { suggestedAmount: "12345" },
      aiSuggested: true,
    });
    expect(suggestion.aiConfirmedAt).toBeNull();

    const confirmed = await confirmAiSuggestion(toCurrentUser(owner), suggestion.id);
    expect(confirmed.aiConfirmedById).toBe(owner.id);
    expect(confirmed.aiConfirmedAt).not.toBeNull();

    await expect(overrideAiSuggestion(toCurrentUser(owner), suggestion.id, "")).rejects.toThrow(ApiError);
    const overridden = await overrideAiSuggestion(toCurrentUser(owner), suggestion.id, "實際需求與建議不符");
    expect(overridden.overrideReason).toBe("實際需求與建議不符");
  });
});
