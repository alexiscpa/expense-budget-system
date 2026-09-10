import { describe, it, expect } from "vitest";
import { createPendingSaveTracker } from "@/lib/client/pendingSave";

describe("pendingSave - centralized pending-save tracker for the back-to-dashboard flow", () => {
  it("resolves true when nothing has ever been registered (nothing to wait for)", async () => {
    const tracker = createPendingSaveTracker();
    await expect(tracker.wait()).resolves.toBe(true);
  });

  it("waits for a registered save and resolves its real outcome (success)", async () => {
    const tracker = createPendingSaveTracker();
    let resolveSave: (v: boolean) => void;
    const save = new Promise<boolean>((resolve) => {
      resolveSave = resolve;
    });
    tracker.register(save);

    let settled = false;
    const waiting = tracker.wait().then((v) => {
      settled = true;
      return v;
    });
    expect(settled).toBe(false); // still pending
    resolveSave!(true);
    await expect(waiting).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it("waits for a registered save and resolves its real outcome (failure)", async () => {
    const tracker = createPendingSaveTracker();
    tracker.register(Promise.resolve(false));
    await expect(tracker.wait()).resolves.toBe(false);
  });

  it("only the most recently registered save matters - an earlier, still-pending save is superseded", async () => {
    const tracker = createPendingSaveTracker();
    const neverResolves = new Promise<boolean>(() => {}); // simulates a slow/abandoned first save
    tracker.register(neverResolves);
    tracker.register(Promise.resolve(true)); // a second, faster save starts after the first

    await expect(tracker.wait()).resolves.toBe(true);
  });

  it("calling wait() more than once (e.g. from two different back buttons) is always safe and returns the same outcome", async () => {
    const tracker = createPendingSaveTracker();
    tracker.register(Promise.resolve(true));
    const [a, b] = await Promise.all([tracker.wait(), tracker.wait()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("a save that resolves after wait() was already called is still correctly awaited (no race)", async () => {
    const tracker = createPendingSaveTracker();
    let resolveSave: (v: boolean) => void;
    tracker.register(
      new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      })
    );
    const waiting = tracker.wait();
    setTimeout(() => resolveSave(false), 5);
    await expect(waiting).resolves.toBe(false);
  });
});
