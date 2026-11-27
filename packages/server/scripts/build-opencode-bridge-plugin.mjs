import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

for (const directory of ["", "v2/"]) {
  const sourcePath = fileURLToPath(
    new URL(
      `../src/server/agent/providers/opencode/${directory}bridge-plugin.mjs`,
      import.meta.url,
    ),
  );
  const outputPath = fileURLToPath(
    new URL(
      `../dist/server/server/agent/providers/opencode/${directory}bridge-plugin.bundle.mjs`,
      import.meta.url,
    ),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await build({
    entryPoints: [sourcePath],
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2022",
    external: ["node:fs", "node:path"],
    outfile: outputPath,
  });
  if (directory === "v2/") {
    await copyFile(
      new URL("../src/server/agent/providers/opencode/v2/state.mjs", import.meta.url),
      path.join(path.dirname(outputPath), "state.mjs"),
    );
  }
}

// tsc emits only .js. The compiled agent-manager imports cursor-rules.mjs at
// runtime, so the .mjs assets have to be copied alongside it. Copy every one in
// this directory: a fixed list leaves the next .mjs import broken in the
// packaged daemon, where the failure appears as a daemon that never opens its
// port.
const v2Source = fileURLToPath(
  new URL("../src/server/agent/providers/opencode/v2/", import.meta.url),
);
const v2Dist = fileURLToPath(
  new URL("../dist/server/server/agent/providers/opencode/v2/", import.meta.url),
);
for (const entry of await readdir(v2Source, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:mjs|d\.mts)$/.test(entry.name)) continue;
  await copyFile(path.join(v2Source, entry.name), path.join(v2Dist, entry.name));
}
