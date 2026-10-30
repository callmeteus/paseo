import { describe, expect, it } from "vitest";
import { configureHubWebview, PASEO_HUB_WEBVIEW_PARTITION } from "./automations-hub-guest";

describe("configureHubWebview", () => {
  it("puts Hub on its own guest so the session cookie is first-party", () => {
    const attributes = new Map<string, string>();
    const style = {
      position: "",
      top: "",
      right: "",
      bottom: "",
      left: "",
      width: "",
      height: "",
      border: "",
    };
    configureHubWebview(
      {
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        style,
      },
      "http://127.0.0.1:3000/triggers",
    );

    expect(attributes.get("src")).toBe("http://127.0.0.1:3000/triggers");
    expect(attributes.get("partition")).toBe(PASEO_HUB_WEBVIEW_PARTITION);
    expect(attributes.get("partition")).toBe("persist:paseo-hub");
    expect(attributes.get("allowpopups")).toBe("true");
    expect(style.position).toBe("absolute");
    expect(style.top).toBe("0");
    expect(style.left).toBe("0");
  });
});
