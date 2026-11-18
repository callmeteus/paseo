// Allo (SIL OFL 1.1) is the interface default. The friendly cut fixes roundness
// at 50 and still varies weight, so the UI ramp can use it without shipping the
// full variable file. https://allo.joshpuckett.me
import { Asset } from "expo-asset";

/* eslint-disable @typescript-eslint/no-require-imports */
const alloFont = require("allo-font/fonts/webfonts/AlloVariableFriendly.woff2");
/* eslint-enable @typescript-eslint/no-require-imports */

const STYLE_ID = "paseo-allo-font";

export function loadBundledFonts(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const uri = Asset.fromModule(alloFont).uri;
  if (uri.length === 0) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `@font-face{font-family:"Allo";src:url(${JSON.stringify(uri)}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`;
  document.head.appendChild(style);
}
