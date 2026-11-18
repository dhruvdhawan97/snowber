import { afterEach, describe, expect, it, vi } from "vitest";
import { roadOrder } from "@/lib/osrm";

const origin = { lat: 43.66, lng: -79.41 };
const a = { id: "a", lat: 43.661, lng: -79.41 };
const b = { id: "b", lat: 43.662, lng: -79.41 };
const before = process.env.OSRM_BASE_URL;
afterEach(() => {
  if (before === undefined) delete process.env.OSRM_BASE_URL;
  else process.env.OSRM_BASE_URL = before;
  vi.unstubAllGlobals();
});

describe("OSRM route ordering", () => {
  it("uses the existing heuristic when OSRM is not configured", async () => {
    delete process.env.OSRM_BASE_URL;
    expect((await roadOrder(origin, [b, a])).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("chooses the lower road travel-time route when OSRM responds", async () => {
    process.env.OSRM_BASE_URL = "http://localhost:5000";
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      code: "Ok", durations: [[0, 100, 10], [100, 0, 10], [10, 30, 0]],
    }) });
    vi.stubGlobal("fetch", fetcher);
    expect((await roadOrder(origin, [a, b])).map((s) => s.id)).toEqual(["b", "a"]);
    expect(String(fetcher.mock.calls[0][0])).toContain("/table/v1/driving/");
  });
  it("falls back on an unavailable OSRM service", async () => {
    process.env.OSRM_BASE_URL = "http://localhost:5000";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await roadOrder(origin, [b, a])).map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("does not use incomplete or unreachable road network tables", async () => {
    process.env.OSRM_BASE_URL = "http://localhost:5000";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      code: "Ok", durations: [[0, null, null], [null, 0, null], [null, null, 0]],
    }) }));
    expect((await roadOrder(origin, [b, a])).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
