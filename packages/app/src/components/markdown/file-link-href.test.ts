import { describe, expect, it } from "vitest";
import { localFileLinkHref } from "./file-link-href";

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
