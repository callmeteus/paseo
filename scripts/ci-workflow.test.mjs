import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    assert.doesNotMatch(source, /actions\/setup-node/, `${name} relies on the runner image's Node`);
  }
});

test("nightly builds desktop and APK from develop and publishes a rolling release", () => {
  const source = workflow("nightly.yml");
  assert.match(source, /^\s+schedule:/m);
  assert.match(source, /cron:/);
  assert.match(source, /ref: develop/);
  assert.match(source, /npm run build:desktop/);
  assert.match(source, /npm run build:apk:arm64/);
  assert.match(source, /mingc\/android-build-box/);
  assert.match(source, /gh release delete/);
  assert.match(source, /gh release create/);
  assert.match(source, /--prerelease/);
});

test("GitHub access uses the gti-ci App, never a personal PAT", () => {
  const files = readdirSync(forgejoWorkflows).filter((name) => name.endsWith(".yml"));
  for (const name of files) {
    const source = workflow(name);
    assert.doesNotMatch(source, /secrets\.GITHUB_TOKEN/, `${name} uses the App token`);
    assert.doesNotMatch(source, /secrets\.GH_TOKEN/, `${name} does not use a PAT`);
    assert.doesNotMatch(source, /EXPO_TOKEN|secrets\.EXPO_TOKEN/, `${name} does not use Expo/EAS`);
    if (source.includes("steps.app-token.outputs.token")) {
      assert.match(source, /actions\/create-github-app-token/, `${name} generates the App token`);
      assert.match(source, /secrets\.GTI_CI_APP_ID/);
      assert.match(source, /secrets\.GTI_CI_APP_PRIVATE_KEY/);
    }
  }
  assert.match(workflow("desktop-release.yml"), /actions\/create-github-app-token/);
  assert.match(workflow("nightly.yml"), /actions\/create-github-app-token/);
});

test("published npm packages declare and ship the repository license", () => {
  const rootManifest = JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));
  const workspaceArgs = rootManifest.scripts["release:publish"].match(/--workspace=\S+/g);
  assert.notEqual(workspaceArgs, null, "release:publish must select public packages");
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json", ...workspaceArgs], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  const manifests = new Map(
    rootManifest.workspaces.map((workspace) => {
      const directory = new URL(`${workspace}/`, repoRoot);
      const manifest = JSON.parse(readFileSync(new URL("package.json", directory), "utf8"));
      return [manifest.name, { directory, manifest }];
    }),
  );
  const licenses = packed.map(({ name, files }) => ({
    name,
    license: manifests.get(name).manifest.license,
    files: files.filter((file) => file.path === "LICENSE").map((file) => file.path),
  }));
  assert.deepEqual(
    licenses,
    workspaceArgs.map((workspace) => ({
      name: workspace.slice("--workspace=".length),
      license: "Apache-2.0",
      files: ["LICENSE"],
    })),
  );
  const repositoryLicense = readFileSync(new URL("LICENSE", repoRoot), "utf8");
  for (const { name } of packed) {
    const { directory } = manifests.get(name);
    assert.equal(readFileSync(new URL("LICENSE", directory), "utf8"), repositoryLicense, name);
  }
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
