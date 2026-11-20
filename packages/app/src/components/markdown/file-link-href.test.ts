import { describe, expect, it } from "vitest";
import { localFileLinkHref, normalizeMarkdownLinkHref } from "./file-link-href";

describe("localFileLinkHref", () => {
  it("turns an absolute folder path into a file URL", () => {
    expect(localFileLinkHref("/mnt/ssd2/software/paseo/.paseo/automations/")).toBe(
      "file:///mnt/ssd2/software/paseo/.paseo/automations/",
    );
  });

  it("keeps an existing file URL", () => {
    expect(localFileLinkHref("file:///tmp/notes.md")).toBe("file:///tmp/notes.md");
  });

  it("leaves web and relative links alone", () => {
    expect(localFileLinkHref("https://paseo.sh")).toBeNull();
    expect(localFileLinkHref("packages/app/src")).toBeNull();
  });
});

describe("normalizeMarkdownLinkHref", () => {
  it("adds https to a scheme-less host with a path", () => {
    expect(normalizeMarkdownLinkHref("github.com/settings/apps/new")).toBe(
      "https://github.com/settings/apps/new",
    );
    expect(normalizeMarkdownLinkHref("www.example.com/docs")).toBe("https://www.example.com/docs");
  });

  it("keeps existing schemes, paths and local file addresses untouched", () => {
    expect(normalizeMarkdownLinkHref("https://github.com/paseo")).toBe("https://github.com/paseo");
    expect(normalizeMarkdownLinkHref("file:///tmp/notes.md")).toBe("file:///tmp/notes.md");
    expect(normalizeMarkdownLinkHref("packages/app/src/component.tsx")).toBe(
      "packages/app/src/component.tsx",
    );
    expect(normalizeMarkdownLinkHref("C:\\Users\\Gio\\file.txt")).toBe("C:\\Users\\Gio\\file.txt");
  });
});
