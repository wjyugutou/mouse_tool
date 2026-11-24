// 摘自 supernsh-icons（https://github.com/SuperNSH/icons，packages/nsh-icons/src/icon.tsx，commit 3443659，MIT）。
import { Image } from "nsh";
import type { ColorValue } from "nsh";
import { type IconData, svgDataUri } from "./markup";

/** The data URI of every icon drawn so far, by identity: hosts cache the
 * decoded image by its src, so a stable string keeps the cache warm. */
const uris = new WeakMap<IconData, string>();

function uriOf(icon: IconData): string {
  let uri = uris.get(icon);
  if (uri === undefined) {
    uri = svgDataUri(icon);
    uris.set(icon, uri);
  }
  return uri;
}

export interface IconProps {
  icon: IconData;
  /** Its height in points (24); the width keeps the icon's aspect ratio. */
  size?: number;
  /** The tint of a monotone icon. Multicolor icons keep their colors. */
  color?: ColorValue;
  /** What a screen reader says. Leave it out when text beside it says the same. */
  label?: string;
  testID?: string;
}

/** An icon drawn sharp at any size. */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 24;
  const [, , width, height] = props.icon.viewBox;
  return (
    <Image
      src={uriOf(props.icon)}
      testID={props.testID}
      accessibilityLabel={props.label}
      style={{
        width: (size() * width) / height,
        height: size(),
        tintColor: props.icon.multicolor ? undefined : props.color,
      }}
    />
  );
}
