import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsDesktop(): boolean {
  // Hybrid: touch + narrow = mobile; fine pointer (desktop) is always desktop
  return !useMediaQuery("(max-width: 860px) and (pointer: coarse)");
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 860px) and (pointer: coarse)");
}
