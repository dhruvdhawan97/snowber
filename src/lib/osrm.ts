/** Optional OSRM road-network ordering. Without a configured OSRM server, fall back
 * to the existing deterministic nearest-neighbor heuristic. Run a walking-profile
 * OSRM server for pedestrian routing; a default driving profile is NOT equivalent.
 */
import { nearestNeighborOrder, type LatLng } from "./geo";

type TableResponse = { code?: string; durations?: (number | null)[][] };

export async function roadOrder<T extends LatLng>(start: LatLng, stops: readonly T[]): Promise<T[]> {
  if (stops.length < 2) return [...stops];
  const fallback = () => nearestNeighborOrder(start, stops);
  const base = process.env.OSRM_BASE_URL?.trim();
  if (!base) return fallback();
  // Limit requests so an unavailable remote routing service doesn't stall dispatch.
  if (stops.length > 24) return fallback();
  try {
    const endpoint = new URL(base.replace(/\/+$/, "") + "/table/v1/driving/" +
      [start, ...stops].map((p) => `${p.lng},${p.lat}`).join(";"));
    endpoint.searchParams.set("annotations", "duration");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1200), cache: "no-store" });
    if (!response.ok) return fallback();
    const data = (await response.json()) as TableResponse;
    const durations = data.durations;
    if (data.code !== "Ok" || !durations || durations.length !== stops.length + 1 ||
      durations.some((row) => row.length !== stops.length + 1)) return fallback();

    const remaining = new Set(stops.map((_, i) => i));
    const ordered: T[] = [];
    let from = 0;
    while (remaining.size > 0) {
      let best = -1;
      let duration = Infinity;
      for (const index of remaining) {
        const seconds = durations[from]?.[index + 1];
        if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
        if (seconds < duration) { duration = seconds; best = index; }
      }
      if (best === -1) return fallback();
      remaining.delete(best);
      ordered.push(stops[best]);
      from = best + 1;
    }
    return ordered;
  } catch {
    return fallback();
  }
}
