/** An OpenUI Lang program always declares `root = SomeComponent(...)`. */
export const OPENUI_ROOT = /(?:^|\n)\s*root\s*=\s*[A-Za-z_$][\w$]*\s*\(/;

export function isOpenUILang(text: string): boolean {
  return OPENUI_ROOT.test(text);
}
