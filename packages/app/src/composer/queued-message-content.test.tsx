// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import type { ComposerAttachment } from "@/attachments/types";
import { i18n } from "@/i18n/i18next";
import { QueuedMessageContent } from "./queued-message-content";

const image: ComposerAttachment = {
  kind: "image",
  metadata: {
    id: "img-1",
    mimeType: "image/png",
    storageType: "inline",
    storageKey: "data:image/png;base64,aaaa",
    fileName: "shot.png",
    createdAt: 0,
  },
};

afterEach(() => {
  cleanup();
});

describe("QueuedMessageContent", () => {
  it("opens a queued image attachment when its thumbnail is pressed", () => {
    const onOpenAttachment = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <QueuedMessageContent
          text="veja"
          attachments={[image]}
          skillNames={[]}
          onOpenAttachment={onOpenAttachment}
        />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByTestId("queued-attachment"));

    expect(onOpenAttachment).toHaveBeenCalledWith(image);
  });
});
