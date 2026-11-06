import { describe, expect, it } from "vitest";
import { isAbsolutePath, pathBasename, resolveWorkspacePath, restoreWindowsFilePath } from "./path";

const SPREADSHEET =
  "C:\\Users\\Gio\\Documents\\Projetos\\Plataformas\\zorro\\entregas\\Servidor-IA-HomeLab-2026-11-05.xlsx";

describe("isAbsolutePath", () => {
  it("returns true for Unix absolute paths", () => {
    expect(isAbsolutePath("/")).toBe(true);
    expect(isAbsolutePath("/home/user")).toBe(true);
    expect(isAbsolutePath("/tmp/file.txt")).toBe(true);
  });

  it("returns true for Windows drive letter paths", () => {
    expect(isAbsolutePath("C:\\Users")).toBe(true);
    expect(isAbsolutePath("C:/Users")).toBe(true);
    expect(isAbsolutePath("d:\\projects")).toBe(true);
  });

  it("returns true for UNC paths", () => {
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("\\\\\\\\host\\path")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isAbsolutePath("foo/bar")).toBe(false);
    expect(isAbsolutePath("./relative")).toBe(false);
    expect(isAbsolutePath("../parent")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
    expect(isAbsolutePath("file.txt")).toBe(false);
  });

  it("returns false for edge cases that are not absolute paths", () => {
    expect(isAbsolutePath("")).toBe(false);
    expect(isAbsolutePath("C:")).toBe(false);
  });

  it("handles mixed separators in absolute paths", () => {
    expect(isAbsolutePath("C:/Users\\mixed/path")).toBe(true);
    expect(isAbsolutePath("/tmp\\mixed/path")).toBe(true);
  });
});

describe("resolveWorkspacePath", () => {
  it("resolves relative paths against the workspace root", () => {
    expect(resolveWorkspacePath("src/app.ts", "C:/repo")).toBe("C:/repo/src/app.ts");
    expect(resolveWorkspacePath(".", "C:/repo")).toBe("C:/repo");
    expect(resolveWorkspacePath("src/../docs/readme.md", "C:/repo")).toBe("C:/repo/docs/readme.md");
  });

  it("passes absolute paths through unchanged", () => {
    expect(resolveWorkspacePath("C:/repo/src/app.ts", "D:/other")).toBe("C:/repo/src/app.ts");
    expect(resolveWorkspacePath("/repo/src/app.ts", "/other")).toBe("/repo/src/app.ts");
  });

  it("returns the path unchanged when there is no workspace root", () => {
    expect(resolveWorkspacePath("src/app.ts", "")).toBe("src/app.ts");
  });
});

describe("restoreWindowsFilePath", () => {
  it("puts the spreadsheet path back together with the drive and backslashes", () => {
    const slashed = SPREADSHEET.replace(/\\/g, "/");
    expect(restoreWindowsFilePath(slashed)).toBe(SPREADSHEET);
    expect(restoreWindowsFilePath(SPREADSHEET)).toBe(SPREADSHEET);
    expect(restoreWindowsFilePath(`  "${slashed}"  `)).toBe(SPREADSHEET);
  });

  it("does not invent a prefix for the leftover relative suffix", () => {
    expect(restoreWindowsFilePath("entregas/Servidor-IA-HomeLab-2026-11-05.xlsx")).toBeNull();
    expect(restoreWindowsFilePath("/tmp/notes.md")).toBeNull();
    expect(restoreWindowsFilePath("C:")).toBeNull();
  });

  it("drops a trailing line marker without touching the drive colon", () => {
    expect(restoreWindowsFilePath("C:\\repo\\src\\app.ts:12-20")).toBe("C:\\repo\\src\\app.ts");
    expect(restoreWindowsFilePath("C:/repo/src/app.ts:12:4")).toBe("C:\\repo\\src\\app.ts");
  });
});

describe("pathBasename", () => {
  it("reads the filename from either separator", () => {
    expect(pathBasename(SPREADSHEET)).toBe("Servidor-IA-HomeLab-2026-11-05.xlsx");
    expect(pathBasename("entregas/Servidor-IA-HomeLab-2026-11-05.xlsx")).toBe(
      "Servidor-IA-HomeLab-2026-11-05.xlsx",
    );
  });
});
