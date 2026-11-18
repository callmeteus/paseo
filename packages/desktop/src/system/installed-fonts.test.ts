import { describe, expect, it, vi } from "vitest";
import { listInstalledFonts, parseFontconfigFamilies, parseFontNameList } from "./installed-fonts";

describe("parseFontconfigFamilies", () => {
  it("keeps the typographic family and separates mono from proportional", () => {
    const faces = parseFontconfigFamilies(
      [
        "Ubuntu\t",
        "Ubuntu,Ubuntu Light\t",
        "Ubuntu Mono\t100",
        "Noto Sans,Noto Sans Condensed SemiBold\t",
        "Liberation Mono\t100",
        "",
      ].join("\n"),
    );

    expect(faces).toEqual([
      { family: "Liberation Mono", monospace: true },
      { family: "Noto Sans", monospace: false },
      { family: "Ubuntu", monospace: false },
      { family: "Ubuntu Mono", monospace: true },
    ]);
  });

  it("leaves a family unclassified when its faces disagree", () => {
    expect(parseFontconfigFamilies("Weird\t100\nWeird\t0\n")).toEqual([
      { family: "Weird", monospace: null },
    ]);
  });

  it("drops names that cannot be stored as a CSS font family", () => {
    expect(parseFontconfigFamilies("Bad;Name\t\nOk Family\t\n")).toEqual([
      { family: "Ok Family", monospace: false },
    ]);
  });
});

describe("parseFontNameList", () => {
  it("returns one unclassified face per line", () => {
    expect(parseFontNameList("Menlo\nHelvetica Neue\nMenlo\n")).toEqual([
      { family: "Helvetica Neue", monospace: null },
      { family: "Menlo", monospace: null },
    ]);
  });
});

describe("listInstalledFonts", () => {
  it("asks fontconfig on Linux", async () => {
    const execFile = vi.fn(async () => ({ stdout: "Ubuntu\t\nUbuntu Mono\t100\n" }));

    await expect(listInstalledFonts({ platform: "linux", execFile })).resolves.toEqual([
      { family: "Ubuntu", monospace: false },
      { family: "Ubuntu Mono", monospace: true },
    ]);
    expect(execFile).toHaveBeenCalledWith("fc-list", ["-f", "%{family}\t%{spacing}\n"]);
  });

  it("uses Swift on macOS when fontconfig is not installed", async () => {
    const execFile = vi.fn(async (file: string) => {
      if (file === "fc-list") {
        const error = new Error("not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return { stdout: "Menlo\nHelvetica Neue\n" };
    });

    await expect(listInstalledFonts({ platform: "darwin", execFile })).resolves.toEqual([
      { family: "Helvetica Neue", monospace: null },
      { family: "Menlo", monospace: null },
    ]);
    expect(execFile).toHaveBeenLastCalledWith("swift", [
      "-e",
      expect.stringContaining("availableFontFamilies"),
    ]);
  });

  it("asks PowerShell on Windows", async () => {
    const execFile = vi.fn(async () => ({ stdout: "Segoe UI\nConsolas\n" }));

    await expect(listInstalledFonts({ platform: "win32", execFile })).resolves.toEqual([
      { family: "Consolas", monospace: null },
      { family: "Segoe UI", monospace: null },
    ]);
    expect(execFile).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-Command", expect.stringContaining("InstalledFontCollection")]),
    );
  });
});
