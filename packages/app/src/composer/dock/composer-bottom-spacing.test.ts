import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

/**
 * The web dock (Electron desktop and browser) must rest the composer above the window
 * edge. The native dock applies the same spacing through resolveComposerBottomPlacement.
 * Upstream #8823 added this padding and our merge dropped it while keeping minWidth: 0,
 * so the composer sat flush on the Windows taskbar. Both properties must survive.
 */
it("rests the web composer above the window bottom edge", () => {
  const source = ts.createSourceFile(
    "dock.tsx",
    readFileSync(new URL("./index.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  let composerStyle: string | null = null;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "composer") {
      const initializer = node.initializer;
      if (ts.isObjectLiteralExpression(initializer)) {
        composerStyle = initializer.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  expect(composerStyle).not.toBeNull();
  expect(composerStyle).toContain("minWidth: 0");
  expect(composerStyle).toContain("paddingBottom: theme.spacing[4]");
});
