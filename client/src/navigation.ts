import { useEffect, useState } from "react";

/** Moves to another page of the app without reloading, as links in emails do. */
export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The current path and its query, kept up to date as the user moves around. */
export function useLocation(): URL {
  const [location, setLocation] = useState(() => new URL(window.location.href));
  useEffect(() => {
    const update = () => setLocation(new URL(window.location.href));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return location;
}
