#!/usr/bin/env node
/**
 * Invokes electron-builder with the default config, except on Linux hosts that
 * lack rpmbuild: electron-builder would fail after producing .deb/.AppImage.
 * CI and Fedora-style machines keep rpmbuild and still get .rpm from the base
 * electron-builder.yml targets list.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfig = join(pkgRoot, "electron-builder.yml");
const require = createRequire(join(pkgRoot, "package.json"));
const electronBuilderCli = join(
  dirname(require.resolve("electron-builder/package.json")),
  "cli.js",
);

/** Only these flags: never inject --config (electron-builder treats default as "run"). */
const PASSTHROUGH_FLAGS_ONLY = new Set(["--help", "-h", "--version"]);

function normalizeUserArgs(argv) {
  if (argv[0] === "--") {
    return argv.slice(1);
  }
  return argv;
}

function shouldPassthroughWithoutConfig(userArgs) {
  return userArgs.length > 0 && userArgs.every((arg) => PASSTHROUGH_FLAGS_ONLY.has(arg));
}

function linuxHostLacksRpmbuild() {
  if (process.platform !== "linux") {
    return false;
  }
  // Do not use shell: true here — Node concatenates args unsafely and the exit
  // status is unreliable for `command -v`. `which` is sufficient for PATH lookup.
  const check = spawnSync("which", ["rpmbuild"], { stdio: "ignore" });
  return check.status !== 0;
}

function resolveConfigPath() {
  if (!linuxHostLacksRpmbuild()) {
    return defaultConfig;
  }
  const dir = mkdtempSync(join(tmpdir(), "paseo-electron-builder-"));
  const path = join(dir, "no-rpm.json");
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        extends: defaultConfig,
        linux: { target: ["AppImage", "deb", "tar.gz"] },
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

const userArgs = normalizeUserArgs(process.argv.slice(2));
const configPath = shouldPassthroughWithoutConfig(userArgs) ? null : resolveConfigPath();
const childArgs = configPath ? ["--config", configPath, ...userArgs] : userArgs;

if (!existsSync(electronBuilderCli)) {
  console.error(`[desktop] electron-builder CLI not found at ${electronBuilderCli}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [electronBuilderCli, ...childArgs], {
  cwd: pkgRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
