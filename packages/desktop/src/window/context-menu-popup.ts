/**
 * Window surface a native context menu is attached to.
 */
export interface ContextMenuWindow {
  /**
   * @returns Whether the native window has already been destroyed.
   */
  isDestroyed(): boolean;

  /**
   * @returns Nothing.
   */
  blur(): void;

  /**
   * @returns Nothing.
   */
  focus(): void;
}

/**
 * Opens a native context menu and, on Linux, gives focus back after it closes.
 *
 * GTK keeps the pointer button down after the menu goes away, so later clicks
 * land nowhere until the window loses focus. Alt+Tab does that by accident.
 * Blurring and focusing again is the same release.
 *
 * @param menu - Menu to show
 * @param window - Window the menu belongs to
 * @param platform - Operating system. Tests pass this explicitly.
 * @param schedule - Runs the focus restore after the blur has been processed
 * @returns Nothing.
 */
export function popupContextMenu<TWindow extends ContextMenuWindow>(
  menu: {
    popup(options?: { window?: TWindow; callback?: () => void }): void;
  },
  window: TWindow,
  platform: NodeJS.Platform = process.platform,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 0);
  },
): void {
  menu.popup({
    window,
    callback: () => {
      // Other platforms already release the pointer when the menu closes.
      if (platform !== "linux") {
        return;
      }

      if (window.isDestroyed()) {
        return;
      }

      window.blur();
      schedule(() => {
        if (window.isDestroyed()) {
          return;
        }

        window.focus();
      });
    },
  });
}
