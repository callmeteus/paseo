import { strict as assert } from "node:assert";
import { describe, it } from "vitest";
import { normalizeHubOrigin } from "./origin.js";

describe("Hub origin", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "allows loopback HTTP for local development: %s",
    (origin) => {
      assert.equal(normalizeHubOrigin(origin), origin);
    },
  );

  it("rejects cleartext credential transport to a remote Hub", () => {
    assert.throws(() => normalizeHubOrigin("http://hub.example.com"), {
      code: "HUB_INVALID_ORIGIN",
      message:
        "Hub URL must be an HTTPS origin without credentials, path, query, or hash. HTTP is allowed for localhost, 127.0.0.1, and [::1]. Enable Allow HTTP in the host settings to use HTTP for other hosts.",
    });
  });

  it("allows a remote HTTP origin when Allow HTTP is enabled", () => {
    assert.equal(
      normalizeHubOrigin("http://100.89.201.14:25000", { allowHttp: true }),
      "http://100.89.201.14:25000",
    );
  });

  it("still rejects credentials, path, query, hash, and non-HTTP schemes when HTTP is enabled", () => {
    for (const origin of [
      "http://hub.example.com/login",
      "http://user:pass@hub.example.com",
      "http://hub.example.com/?q=1",
      "http://hub.example.com/#hash",
      "ftp://hub.example.com",
    ]) {
      assert.throws(() => normalizeHubOrigin(origin, { allowHttp: true }), {
        code: "HUB_INVALID_ORIGIN",
      });
    }
  });
});
