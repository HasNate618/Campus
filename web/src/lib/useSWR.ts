import { useEffect, useState } from "react";

// Stale-while-revalidate for page-level GETs. Top-level pages remount on
// every mobile tab switch; without a cache each one paints empty until its
// fetch resolves.
//
// Two tiers:
//   L1 — in-memory Map for instant remount paints within a session
//   L2 — sessionStorage so a COLD boot (hard refresh, dev-server full
//        reload, second tab) also paints last-known content immediately
// Every mount still revalidates in the background, so staleness self-heals.
const CACHE_KEY = "hc.swr";
type CacheObj = Record<string, unknown>;

const cache: Map<string, unknown> = (() => {
	try {
		return new Map(
			Object.entries(
				JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "{}") as CacheObj,
			),
		);
	} catch {
		return new Map(); // private mode / quota / corrupt JSON — start cold
	}
})();

function persist(key: string, value: unknown): void {
	cache.set(key, value);
	try {
		const obj = JSON.parse(
			sessionStorage.getItem(CACHE_KEY) ?? "{}",
		) as CacheObj;
		obj[key] = value;
		sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
	} catch {
		/* non-fatal */
	}
}

/**
 * @param key     stable request key ('courses', 'digest', …)
 * @param fetcher called on every mount to revalidate
 * @param initial value before the first fetch resolves
 * @returns [data, loading] — loading is true only when nothing is cached yet
 */
export function useSWR<T>(
	key: string,
	fetcher: () => Promise<T>,
	initial: T,
): [T, boolean] {
	const [data, setData] = useState<T>(() =>
		cache.has(key) ? (cache.get(key) as T) : initial,
	);
	const [loading, setLoading] = useState(() => !cache.has(key));

	useEffect(() => {
		let alive = true;
		fetcher()
			.then((d) => {
				if (!alive) return;
				persist(key, d);
				setData(d);
			})
			.catch(console.error) // keep whatever we already have on failure
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
		// `key` identifies the request; fetcher identity changes every render
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	return [data, loading];
}
