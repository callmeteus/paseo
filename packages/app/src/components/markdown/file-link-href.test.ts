import { describe, expect, it } from "vitest";
import {
  isLocalFileHref,
  localFileHrefToPath,
  localFileLinkHref,
  normalizeMarkdownLinkHref,
} from "./file-link-href";

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

describe("local file href helpers", () => {
  it("detects local paths and file URLs but not web links", () => {
    expect(isLocalFileHref("/tmp/opencode/hub-bootstrap-password")).toBe(true);
    expect(isLocalFileHref("file:///tmp/notes.md")).toBe(true);
    expect(isLocalFileHref("C:\\Users\\Gio\\file.txt")).toBe(true);
    expect(isLocalFileHref("C:/Users/Gio/file.txt")).toBe(true);
    expect(isLocalFileHref("\\\\server\\share\\file.txt")).toBe(true);
    expect(isLocalFileHref("file://server/share/file.txt")).toBe(true);
    expect(isLocalFileHref("https://github.com/paseo")).toBe(false);
    expect(isLocalFileHref("mailto:gio@example.com")).toBe(false);
    expect(isLocalFileHref("packages/app/src")).toBe(false);
  });

  it("turns a file URL back into a plain path", () => {
    expect(localFileHrefToPath("file:///tmp/opencode/hub-bootstrap-password")).toBe(
      "/tmp/opencode/hub-bootstrap-password",
    );
    expect(localFileHrefToPath("file:///tmp/with%20space")).toBe("/tmp/with space");
    expect(localFileHrefToPath("file:///C:/Users/Gio/file.txt")).toBe("C:/Users/Gio/file.txt");
    expect(localFileHrefToPath("file://server/share/file%20name.txt")).toBe(
      "\\\\server\\share\\file name.txt",
    );
    expect(localFileHrefToPath("C:\\Users\\Gio\\file.txt")).toBe("C:\\Users\\Gio\\file.txt");
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
