import { useSyncExternalStore } from "react";

const query = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Follows the system color scheme. Renders light on the server. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
