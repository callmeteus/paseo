/* eslint-disable paseo/no-sync-io -- merge: pre-existing synchronous IO */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL?.startsWith("file:") &&
    specifier.startsWith(".") &&
    specifier.endsWith(".js")
  ) {
    const candidateUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
    if (existsSync(fileURLToPath(candidateUrl))) {
      return {
        url: candidateUrl.href,
        shortCircuit: true,
      };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);

  // The CI runner's Node has no TypeScript support, and native loaders (tsx /
  // esbuild) crash there. TypeScript's transpiler is pure JavaScript and emits
  // the same runnable ESM without relying on a native binary.
  const fileName = fileURLToPath(url);
  const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  return { format: "module", source: outputText, shortCircuit: true };
}
