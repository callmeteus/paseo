// Forgejo Actions has no equivalent of dorny/paths-filter. Compute the same
// CI contracts from `git diff` against the merge base so unchanged domains
// can skip their jobs. GitHub Actions keeps .github/ci-paths.yml as the
// contract source; this script mirrors the minimum needed by the Forgejo CI.
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const base = process.argv[2] ?? "origin/develop";
const event = process.env.GITHUB_EVENT_NAME ?? "push";

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

let changed = [];
try {
  const mergeBase = git(["merge-base", base, "HEAD"]);
  changed = git(["diff", "--name-only", mergeBase, "HEAD"]).split("\n").filter(Boolean);
} catch {
  // No base available (first run / shallow mirror): run everything.
  changed = ["__all__"];
}

const contracts = {
  format: [".github/**", "**/*.{cjs,css,html,js,json,jsonc,jsx,md,mjs,ts,tsx,yaml,yml}"],
  quality: ["**/*.{cjs,js,json,jsx,mjs,ts,tsx}"],
  server: ["packages/server/**", "plugins/**", "package.json", "package-lock.json"],
  desktop: ["packages/desktop/**", "packages/app/src/desktop/**"],
  app: ["packages/app/**", "packages/expo-two-way-audio/**"],
  sdk: [
    "packages/protocol/**",
    "packages/client/**",
    "packages/plugin/**",
    "packages/highlight/**",
  ],
  website: ["packages/website/**", "public-docs/**"],
};

function matches(pattern, file) {
  const re = pattern
    .replaceAll(".", "\\.")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${re}$`).test(file);
}

const outputs = {};
outputs.full =
  event === "schedule" || event === "workflow_dispatch" || changed.includes("__all__")
    ? "true"
    : "false";
for (const [name, patterns] of Object.entries(contracts)) {
  outputs[name] = changed.some((file) => patterns.some((pattern) => matches(pattern, file)))
    ? "true"
    : "false";
}

for (const [key, value] of Object.entries(outputs)) {
  process.stdout.write(`${key}=${value}\n`);
}
