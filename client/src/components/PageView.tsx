import { useEffect, useState } from "react";

import { getContext, type PageContext } from "../api.ts";

export function PageView({ imageId }: { imageId: string }) {
  const [context, setContext] = useState<PageContext | null>(null);

  useEffect(() => {
    getContext(imageId).then(setContext);
  }, [imageId]);

  if (!context) return <p className="status">Loading page…</p>;

  const { box, width, height } = context;
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div className="page-view">
      <img src={context.pageImageUrl} alt="The full page" />
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
