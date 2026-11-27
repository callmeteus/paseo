import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readValidatedJson, readValidatedString } from "./validated-storage";

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("validated storage reads", () => {
  it("clears a payload that cannot be parsed as JSON", async () => {
    const storage = new MemoryStorage();
    storage.values.set("settings", "{");

    await expect(
      readValidatedJson(storage, "settings", z.strictObject({ enabled: z.boolean() })),
    ).resolves.toBeNull();
    expect(storage.values.has("settings")).toBe(false);
  });

  it("keeps the valid fields when one field is invalid for the current schema", async () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ enabled: true, channel: "nightly", surprise: true });
    storage.values.set("settings", raw);

    await expect(
      readValidatedJson(
        storage,
        "settings",
        z.strictObject({
          enabled: z.boolean(),
          channel: z.enum(["stable", "beta"]).optional(),
        }),
      ),
    ).resolves.toEqual({ enabled: true });
    expect(storage.values.get("settings")).toBe(raw);
  });

  it("clears invalid scalar values", async () => {
    const storage = new MemoryStorage();
    storage.values.set("channel", "nightly");

    await expect(
      readValidatedString(storage, "channel", z.enum(["stable", "beta"])),
    ).resolves.toBeNull();
    expect(storage.values.has("channel")).toBe(false);
  });

  it("returns only schema-validated values", async () => {
    const storage = new MemoryStorage();
    storage.values.set("settings", JSON.stringify({ enabled: true }));

    await expect(
      readValidatedJson(storage, "settings", z.strictObject({ enabled: z.boolean() })),
    ).resolves.toEqual({ enabled: true });
    expect(storage.values.has("settings")).toBe(true);
  });
});
