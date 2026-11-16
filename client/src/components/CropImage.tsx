import { useEffect, useState } from "react";

const SCALE = 3;
const MAX_WIDTH = 384;
const MAX_HEIGHT = 640;
const STORAGE_KEY = "crop-view";

export interface CropView {
  /** How much larger than usual to show crops, from 0.5 to 3. */
  zoom: number;
  /** Contrast and brightness, as CSS filter amounts where 1 is unchanged. */
  contrast: number;
  brightness: number;
}

const DEFAULT_VIEW: CropView = { zoom: 1, contrast: 1, brightness: 1 };

function readView(): CropView {
  try {
    return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULT_VIEW;
  }
}

/** The user's zoom and contrast for crops, remembered in this browser. */
export function useCropView(): [CropView, (view: CropView) => void] {
  const [view, setView] = useState(readView);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
      // The setting just lasts for this visit if the browser blocks storage.
    }
  }, [view]);
  return [view, setView];
}

/**
 * Shows a crop enlarged by a fixed amount, so that words keep their sizes relative to each other. Only
 * crops that would not fit are scaled by less. `view` adds the user's zoom and contrast.
 */
export function CropImage({ src, alt, view }: { src: string; alt?: string; view?: CropView }) {
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const zoom = view?.zoom ?? 1;
  const scale = natural
    ? Math.min(SCALE, MAX_WIDTH / natural.width, MAX_HEIGHT / natural.height) * zoom
    : undefined;

  return (
    <img
      className="crop"
      src={src}
      alt={alt ?? "A word cut from a scanned page"}
      style={{
        ...(natural && scale ? { width: natural.width * scale, height: natural.height * scale } : {}),
        ...(view && (view.contrast !== 1 || view.brightness !== 1)
          ? { filter: `contrast(${view.contrast}) brightness(${view.brightness})` }
          : {}),
      }}
      onLoad={({ currentTarget: { naturalWidth, naturalHeight } }) =>
        setNatural({ width: naturalWidth, height: naturalHeight })
      }
    />
  );
}

/** Buttons and sliders for zoom, contrast, and brightness. */
export function CropViewControls({ view, onChange }: { view: CropView; onChange: (view: CropView) => void }) {
  const set = (change: Partial<CropView>) => onChange({ ...view, ...change });
  const zoomBy = (factor: number) => set({ zoom: Math.min(3, Math.max(0.5, Math.round(view.zoom * factor * 100) / 100)) });
  const changed = view.zoom !== 1 || view.contrast !== 1 || view.brightness !== 1;
  return (
    <div className="crop-controls" role="group" aria-label="Image view">
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
        −
      </button>
      <span aria-live="polite">{Math.round(view.zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.25)}>
        +
      </button>
      <label>
        Contrast
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.1}
          value={view.contrast}
          onChange={(event) => set({ contrast: Number(event.target.value) })}
        />
      </label>
      <label>
        Brightness
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={view.brightness}
          onChange={(event) => set({ brightness: Number(event.target.value) })}
        />
      </label>
      {changed && (
        <button type="button" className="link" onClick={() => onChange(DEFAULT_VIEW)}>
          Reset
        </button>
      )}
    </div>
  );
}
