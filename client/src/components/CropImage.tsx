import { useState } from "react";

const SCALE = 2;
const MAX_WIDTH = 256;
const MAX_HEIGHT = 512;

/**
 * Shows a crop enlarged by a fixed amount, so that words keep their sizes relative to each other. Only
 * crops that would not fit are scaled by less.
 */
export function CropImage({ src }: { src: string }) {
  const [size, setSize] = useState<{ width: number; height: number }>();

  return (
    <img
      className="crop"
      src={src}
      alt="The word to label"
      style={size}
      onLoad={({ currentTarget: { naturalWidth, naturalHeight } }) => {
        const scale = Math.min(SCALE, MAX_WIDTH / naturalWidth, MAX_HEIGHT / naturalHeight);
        setSize({ width: naturalWidth * scale, height: naturalHeight * scale });
      }}
    />
  );
}
