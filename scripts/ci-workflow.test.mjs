import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative as relativePath } from "node:path";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);
const forgejoWorkflows = new URL(".forgejo/workflows/", repoRoot);
const filtersPath = new URL(".github/ci-paths.yml", repoRoot);

function workflow(name) {
  return readFileSync(new URL(name, forgejoWorkflows), "utf8");
}

function filesUnder(relativeDirectory, predicate) {
  const directory = new URL(`${relativeDirectory}/`, repoRoot);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [relativeDirectory, relativePath(directory.pathname, entry.parentPath), entry.name]
        .filter(Boolean)
        .join("/")
        .replaceAll("\\", "/"),
    )
    .filter(predicate)
    .sort();
}

function loadFilters(path) {
  const filters = {};
  let currentFilter;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const filterMatch = /^([a-z_]+):\s*$/.exec(line);
    if (filterMatch) {
      currentFilter = filterMatch[1];
      filters[currentFilter] = [];
      continue;
    }
    const patternMatch = /^  - "([^"]+)"\s*$/.exec(line);
    if (currentFilter && patternMatch) filters[currentFilter].push(patternMatch[1]);
  }
  return filters;
}

test("every Forgejo workflow is dispatchable and uses the Linux runner", () => {
  const files = readdirSync(forgejoWorkflows).filter((name) => name.endsWith(".yml"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const source = workflow(name);
    assert.match(source, /^name: /m, `${name} has a name`);
    assert.match(source, /^on:\n/m, `${name} has triggers`);
    assert.match(source, /workflow_dispatch:/, `${name} is manually dispatchable`);
    assert.doesNotMatch(
      source,
      /runs-on: (ubuntu-|windows-|macos-|macos-)/,
      `${name} uses the docker runner`,
    );
    assert.doesNotMatch(source, /permissions:/, `${name} has no GitHub-only permissions block`);
  }
});

test("nightly builds desktop and APK from develop and publishes a rolling release", () => {
  const source = workflow("nightly.yml");
  assert.match(source, /^\s+schedule:/m);
  assert.match(source, /cron:/);
  assert.match(source, /ref: develop/);
  assert.match(source, /npm run build:desktop/);
  assert.match(source, /eas build --platform android/);
  assert.match(source, /gh release delete/);
  assert.match(source, /gh release create/);
  assert.match(source, /--prerelease/);
});

test("GitHub Releases use a Forgejo secret, never the implicit GITHUB_TOKEN", () => {
  const files = readdirSync(forgejoWorkflows).filter((name) => name.endsWith(".yml"));
  for (const name of files) {
    const source = workflow(name);
    assert.doesNotMatch(source, /secrets\.GITHUB_TOKEN/, `${name} uses GH_TOKEN`);
  }
  assert.match(workflow("desktop-release.yml"), /secrets\.GH_TOKEN/);
  assert.match(workflow("nightly.yml"), /secrets\.GH_TOKEN/);
});

test("CI contracts stay with the GitHub source of truth", () => {
  const filters = loadFilters(filtersPath);
  assert.ok(filters.routing.includes(".github/ci-paths.yml"));
  assert.ok(filters.ci.includes(".github/workflows/ci.yml") === false);
  assert.ok(Object.keys(filters).length > 0);
});

test("cross-package invariants live in the suite that owns them", () => {
  const cliTests = filesUnder("packages/cli", (path) => path.endsWith(".test.ts"));
  assert.ok(cliTests.length > 0);
  for (const path of cliTests) {
    assert.doesNotMatch(
      readFileSync(new URL(path, repoRoot), "utf8"),
      /server\/src\/server\/test-utils/,
    );
  }
  const protocolWireCompatibility = new URL(
    "packages/protocol/src/messages.wire-compat.test.ts",
    repoRoot,
  );
  assert.match(readFileSync(protocolWireCompatibility, "utf8"), /wire schema compatibility/);
});

test("stable iOS releases upload once and distribute to external testers before App Store review", () => {
  const source = readFileSync(
    new URL("packages/app/.eas/workflows/release-mobile.yml", repoRoot),
    "utf8",
  );
  assert.match(source, /type: testflight/);
  assert.match(source, /external_groups:\s*\n\s+- Paseo Beta/);
  assert.match(source, /bundle exec fastlane ios submit_review/);
});
