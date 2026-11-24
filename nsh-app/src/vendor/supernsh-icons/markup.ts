// 摘自 supernsh-icons（https://github.com/SuperNSH/icons，packages/nsh-icons/src，commit 3443659，MIT）。
// 只保留 TSX 运行时需要的部分；图标数据由它的 CLI 从 Iconify 生成，见 ../../icons.ts。

/** One icon as `supernsh-icons add` writes it into an app. */
export interface IconData {
  /** The set's prefix, such as `lucide`. */
  set: string;
  /** The icon's Iconify name, such as `arrow-left`. */
  name: string;
  /** The SVG content inside `<svg>`. */
  body: string;
  /** `[left, top, width, height]`. */
  viewBox: readonly [number, number, number, number];
  /** Drawn in its own colors (logos, flags, emoji); `color` does not tint it. */
  multicolor: boolean;
}

/** The whole SVG document of an icon. */
export function svgMarkup(icon: Pick<IconData, "body" | "viewBox">): string {
  const [left, top, width, height] = icon.viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}">${icon.body}</svg>`;
}

/** The icon as a `data:` URL an `Image` shows. */
export function svgDataUri(icon: Pick<IconData, "body" | "viewBox">): string {
  return `data:image/svg+xml,${encodeURIComponent(svgMarkup(icon))}`;
}
