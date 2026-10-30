/** Electron guest partition. Must match `PASEO_HUB_PARTITION` in the desktop package. */
export const PASEO_HUB_WEBVIEW_PARTITION = "persist:paseo-hub";

interface HubWebviewElement {
  setAttribute(name: string, value: string): void;
  style: {
    position: string;
    top: string;
    right: string;
    bottom: string;
    left: string;
    width: string;
    height: string;
    border: string;
  };
}

/**
 * Configures the Electron guest that hosts Hub.
 *
 * An iframe under the Paseo window is a cross-site frame. Hub's session cookie
 * is SameSite=Lax, so the browser drops it and sign-in never leaves the form.
 *
 * @param frame - Guest element
 * @param src - Triggers page on the Hub origin
 * @returns Nothing.
 */
export function configureHubWebview(frame: HubWebviewElement, src: string): void {
  frame.setAttribute("src", src);
  frame.setAttribute("partition", PASEO_HUB_WEBVIEW_PARTITION);
  frame.setAttribute("allowpopups", "true");
  frame.setAttribute("data-testid", "automations-webview");
  frame.style.position = "absolute";
  frame.style.top = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.left = "0";
  frame.style.width = "100%";
  frame.style.height = "100%";
  frame.style.border = "none";
}
