import { useEffect, useState } from "react";

import { getContext, type PageContext } from "../api.ts";

/** The full page with the word's box drawn on it. */
export function PageImage({ context, small }: { context: PageContext; small?: boolean }) {
  const { box, width, height } = context;
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div className={small ? "page-view small" : "page-view"}>
      <img src={context.pageImageUrl} alt="The page this word comes from, with the word outlined in red" />
      <div
        className="word-box"
        data-testid="word-box"
        style={{
          left: percent(box.x, width),
          top: percent(box.y, height),
          width: percent(box.width, width),
          height: percent(box.height, height),
        }}
      />
    </div>
  );
}

export function PageView({ imageId, small }: { imageId: string; small?: boolean }) {
  const [context, setContext] = useState<PageContext | null>(null);

  useEffect(() => {
    getContext(imageId).then(setContext);
  }, [imageId]);

  if (!context) return <p className="status">Loading page…</p>;
  return <PageImage context={context} small={small} />;
}

/** The page beside a crop, small at first, with a button to see it larger. */
export function PagePreview({ context }: { context: PageContext }) {
  const [large, setLarge] = useState(false);
  return (
    <figure className={large ? "page-preview large" : "page-preview"}>
      <figcaption>
        On the page{" "}
        <button type="button" className="link" onClick={() => setLarge(!large)}>
          {large ? "smaller" : "larger"}
        </button>
      </figcaption>
      <PageImage context={context} small={!large} />
    </figure>
  );
}
