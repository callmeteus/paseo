import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

/**
 * Every dev launcher must stay reachable from another device on the tailnet. These files
 * are the whole contract; nothing else asserts it, and a launcher that silently reverts to
 * `localhost` still "works" on the machine that started it.
 */
const repoRoot = join(import.meta.dirname, "..");

async function read(relativePath) {
  return readFile(join(repoRoot, relativePath), "utf8");
}

async function readRootPackageJson() {
  return JSON.parse(await read("package.json"));
}

test("the daemon dev launcher binds every interface and prints the tailnet URL", async () => {
  const source = await read("scripts/dev-daemon.sh");

  assert.match(source, /PASEO_LISTEN:-0\.0\.0\.0:/, "daemon must default to 0.0.0.0");
  assert.match(source, /PASEO_CORS_ORIGINS:-\*/, "dev must allow any CORS origin");
  assert.match(source, /dev_tailscale_ipv4/, "launcher must detect the tailnet address");
  assert.match(source, /Tailnet:/, "launcher must print the tailnet URL");
});

test("the app dev launcher exposes Metro to the LAN with a tailnet daemon endpoint", async () => {
  const source = await read("scripts/dev-app.sh");

  assert.match(source, /--host lan/, "Metro must bind the LAN");
  assert.match(source, /PASEO_LISTEN:-0\.0\.0\.0:/, "daemon must default to 0.0.0.0");
  assert.match(source, /EXPO_PUBLIC_LOCAL_DAEMON/, "the bundle must point at the tailnet daemon");
  assert.match(source, /Tailnet:/, "launcher must print the tailnet URL");
});

test("the Windows dev launcher binds the LAN and prefers the tailnet address", async () => {
  const source = await read("scripts/dev.ps1");

  assert.match(source, /tailscale ip -4/, "launcher must detect the tailnet address");
  assert.match(source, /PASEO_LISTEN = "0\.0\.0\.0:/, "daemon must bind 0.0.0.0");
  assert.match(source, /PASEO_CORS_ORIGINS = "\*"/, "dev must allow any CORS origin");
  assert.match(source, /--host lan/, "Metro must bind the LAN");
  assert.match(source, /Tailnet:/, "launcher must print the tailnet URL");
});

test("the desktop dev launchers bind their isolated daemon to the LAN", async () => {
  const shell = await read("packages/desktop/scripts/dev.sh");
  const powershell = await read("packages/desktop/scripts/dev.ps1");

  assert.match(shell, /PASEO_LISTEN:-0\.0\.0\.0:/, "desktop dev must default to 0.0.0.0");
  assert.match(shell, /dev_tailscale_ipv4/, "desktop dev must detect the tailnet address");
  assert.match(shell, /Tailnet:/, "desktop dev must print the tailnet URL");

  assert.match(powershell, /PASEO_LISTEN = "0\.0\.0\.0:/, "desktop dev must bind 0.0.0.0");
  assert.match(powershell, /tailscale ip -4/, "desktop dev must detect the tailnet address");
  assert.match(powershell, /Tailnet:/, "desktop dev must print the tailnet URL");
});

test("the website dev server binds every interface", async () => {
  const source = await read("packages/website/vite.config.ts");

  assert.match(source, /host: "0\.0\.0\.0"/, "vite must listen on every interface in dev");
});

test("the root dev scripts hand the LAN bind to the daemon", async () => {
  const scripts = (await readRootPackageJson()).scripts;

  for (const name of ["dev:server", "dev:app", "dev:desktop"]) {
    assert.match(scripts[name] ?? "", /PASEO_LISTEN=0\.0\.0\.0:/, `${name} must bind the LAN`);
  }
});
