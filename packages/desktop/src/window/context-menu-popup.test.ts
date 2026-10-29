import { describe, expect, it, vi } from "vitest";

import { popupContextMenu, type ContextMenuWindow } from "./context-menu-popup";

function createWindow(destroyed = false): ContextMenuWindow & {
  blur: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  return {
    isDestroyed: () => destroyed,
    blur: vi.fn(),
    focus: vi.fn(),
  };
}

describe("popupContextMenu", () => {
  it("blurs and then focuses the window after a Linux menu closes", () => {
    const window = createWindow();
    let onClose: (() => void) | undefined;
    const menu = {
      popup: (options?: { callback?: () => void }) => {
        onClose = options?.callback;
      },
    };
    const schedule = vi.fn();

    popupContextMenu(menu, window, "linux", schedule);
    onClose?.();

    expect(window.blur).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(window.focus).not.toHaveBeenCalled();

    const restoreFocus = schedule.mock.calls[0]?.[0];
    if (typeof restoreFocus !== "function") {
      throw new Error("focus restore was not scheduled");
    }
    restoreFocus();

    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it("leaves the window alone when the menu closes on macOS", () => {
    const window = createWindow();
    let onClose: (() => void) | undefined;
    const menu = {
      popup: (options?: { callback?: () => void }) => {
        onClose = options?.callback;
      },
    };
    const schedule = vi.fn();

    popupContextMenu(menu, window, "darwin", schedule);
    onClose?.();

    expect(window.blur).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not touch a window that was destroyed before the menu closed", () => {
    const window = createWindow(true);
    let onClose: (() => void) | undefined;
    const menu = {
      popup: (options?: { callback?: () => void }) => {
        onClose = options?.callback;
      },
    };
    const schedule = vi.fn();

    popupContextMenu(menu, window, "linux", schedule);
    onClose?.();

    expect(window.blur).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not focus a window destroyed while the blur is settling", () => {
    const window = createWindow(false);
    let destroyed = false;
    window.isDestroyed = () => destroyed;
    let onClose: (() => void) | undefined;
    const menu = {
      popup: (options?: { callback?: () => void }) => {
        onClose = options?.callback;
      },
    };
    const schedule = vi.fn();

    popupContextMenu(menu, window, "linux", schedule);
    onClose?.();
    destroyed = true;
    const restoreFocus = schedule.mock.calls[0]?.[0];
    if (typeof restoreFocus !== "function") {
      throw new Error("focus restore was not scheduled");
    }
    restoreFocus();

    expect(window.blur).toHaveBeenCalledTimes(1);
    expect(window.focus).not.toHaveBeenCalled();
  });
});
