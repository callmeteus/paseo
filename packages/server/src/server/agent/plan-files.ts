import path from "node:path";
import { isSameOrDescendantPath, resolvePathFromBase } from "../path-utils.js";

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

export class PlanPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPathError";
  }
}

/** Resolves a plan name to a markdown file under `$PASEO_HOME/plans/{workspaceId}`. */
export function resolvePlanFile(input: {
  paseoHome: string;
  workspaceId: string;
  requestedPath: string;
}): { absolutePath: string; title: string } {
  const root = planDirectory(input.paseoHome, input.workspaceId);
  const absolutePath = ensureMarkdown(resolvePathFromBase(root, planRequest(input.requestedPath)));
  if (!isSameOrDescendantPath(root, absolutePath)) {
    throw new PlanPathError(
      "Plan files stay in the Paseo home directory. Pass a file name such as feature-name.md.",
    );
  }
  return {
    absolutePath,
    title: path.basename(absolutePath, path.extname(absolutePath)),
  };
}

function planDirectory(paseoHome: string, workspaceId: string): string {
  const home = paseoHome.trim();
  if (!home) {
    throw new PlanPathError("Paseo home is not configured");
  }
  // Workspace ids are `wks_` plus hex. Anything else could escape the plans directory.
  if (!/^[\w.-]+$/.test(workspaceId)) {
    throw new PlanPathError("Plan workspace is invalid");
  }
  return path.resolve(home, "plans", workspaceId);
}

function planRequest(requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new PlanPathError("Plan path is empty");
  }
  const slashed = trimmed.replace(/\\/g, "/");
  if (isHomeOrAbsolute(slashed)) return trimmed;
  const relative = slashed.replace(/^\.\//, "").replace(/^plans\//, "");
  if (!relative || relative === "." || relative.endsWith("/")) {
    throw new PlanPathError("Plan path is empty");
  }
  return relative;
}

function isHomeOrAbsolute(value: string): boolean {
  return (
    value === "~" || value.startsWith("~/") || value.startsWith("/") || /^[A-Za-z]:\//.test(value)
  );
}

function ensureMarkdown(filePath: string): string {
  return MARKDOWN_EXTENSION.test(filePath) ? filePath : `${filePath}.md`;
}
