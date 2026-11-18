// Native builds do not bundle Allo. The stored family still resolves to the
// platform stack in resolveUiFontStack until a native face is registered.
export function loadBundledFonts(): void {}
