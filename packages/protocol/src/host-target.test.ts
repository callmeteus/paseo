import { expect, test } from "vitest";
import { parseHostTarget } from "./host-target.js";

test.each([
  ["127.0.0.1:17000", "tcp://127.0.0.1:17000"],
  ["4321", "tcp://127.0.0.1:4321"],
  ["[::1]:4321", "tcp://[::1]:4321"],
  ["unix:///tmp/paseo.sock", "unix:///tmp/paseo.sock"],
  ["pipe://\\\\.\\pipe\\paseo", "pipe://\\\\.\\pipe\\paseo"],
  ["wss://example.com/custom?token=secret", "wss://example.com"],
  ["tcp://example.com:17000?password=secret", "tcp://example.com:17000"],
])(
  "the shared connector accepts %s and exposes only safe display text",
  (connection, description) => {
    expect(parseHostTarget(connection).description).toBe(description);
  },
);
test("SSH daemon credentials are separate from SSH authentication and excluded from display text", () => {
  expect(parseHostTarget("ssh://deploy@build-box:2222?daemonPort=7777&password=secret")).toEqual({
    kind: "ssh",
    ssh: { host: "deploy@build-box", sshPort: 2222, daemonPort: 7777 },
    password: "secret",
    description: "ssh://build-box:2222 (daemon port 7777)",
  });
});
test.each([
  "",
  "ssh://-bad",
  "ssh://user:secret@host",
  "ssh://host?unknown=secret",
  "unix://",
  "tcp://host:0",
  "C:\\Users\\socket",
  "alice:example-secret@localhost:17000",
  "not-a-scheme://localhost:17000",
  "localhost/path:17000",
  "localhost?password=example-secret:17000",
  "localhost#example-secret:17000",
  "tcp://localhost/path:17000",
  "relay://alice:example-secret@localhost:17000/server?key=private",
])("invalid target syntax is rejected without echoing %s", (connection) => {
  expect(() => parseHostTarget(connection)).toThrow("Invalid host connection");
});

test("SSH aliases and DNS names retain their connection semantics", () => {
  expect(parseHostTarget("build-box.example.:17000").description).toBe(
    "tcp://build-box.example.:17000",
  );
  expect(parseHostTarget("ssh://deploy@my_ssh-alias")).toMatchObject({
    kind: "ssh",
    ssh: { host: "deploy@my_ssh-alias" },
  });
});

test("encoded SSH usernames cannot leak into the target description", () => {
  expect(parseHostTarget("ssh://alice%3Aexample-secret@my-alias").description).toBe(
    "ssh://my-alias (daemon port 17000)",
  );
});

test("pairing offers cannot publish a credential-bearing or malformed relay authority", () => {
  for (const endpoint of [
    "alice:example-secret@localhost:17000",
    "localhost/path:17000",
    "localhost?token=example-secret:17000",
  ]) {
    const offer = {
      v: 2,
      serverId: "srv_test",
      daemonPublicKeyB64: "private-key",
      relay: { endpoint, useTls: false },
    };
    const url = `https://app.paseo.sh/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
    expect(() => parseHostTarget(url)).toThrow("Invalid host connection");
  }
});
