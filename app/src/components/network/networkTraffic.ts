export const TRAFFIC_WINDOW_MS = 60_000;
export const TRAFFIC_INTERVAL_MS = 1_000;
export type TrafficSample = {
  sampledAt: number;
  generation: number;
  traffic: { up: number; down: number; upTotal: number; downTotal: number };
};
export type MemorySample = {
  sampledAt: number;
  generation: number;
  memory: { inuse: number };
};
export function appendTraffic(
  history: TrafficSample[],
  sample: TrafficSample,
): TrafficSample[] {
  if (history.at(-1)?.generation !== sample.generation) return [sample];
  if ((history.at(-1)?.sampledAt ?? 0) >= sample.sampledAt) return history;
  return [...history.slice(-59), sample];
}

// Time, rather than array index, determines the horizontal position. Do not
// join across a missed interval (hidden view, disconnected core, slow read).
// Bezier control points stay inside each segment's value range: no fake peaks.
export function trafficPath(
  history: TrafficSample[],
  direction: "up" | "down",
  end: number,
  max: number,
) {
  const points = history.map((sample) => ({
    x: 600 + ((sample.sampledAt - end) / TRAFFIC_WINDOW_MS) * 600,
    y: 100 - (sample.traffic[direction] / max) * 96,
    at: sample.sampledAt,
  }));
  const joined = (left: number, right: number) =>
    left >= 0 &&
    right < points.length &&
    points[right].at - points[left].at <= 2_500;
  const slope = (left: number, right: number) =>
    (points[right].y - points[left].y) / (points[right].x - points[left].x);
  const tangent = (index: number) => {
    const before = joined(index - 1, index)
      ? slope(index - 1, index)
      : undefined;
    const after = joined(index, index + 1)
      ? slope(index, index + 1)
      : undefined;
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    return before * after <= 0
      ? 0
      : Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
  };
  return points
    .map((point, index) => {
      if (!joined(index - 1, index)) return `M${point.x},${point.y}`;
      const before = points[index - 1];
      const dx = (point.x - before.x) / 3;
      return `C${before.x + dx},${before.y + tangent(index - 1) * dx} ${point.x - dx},${point.y - tangent(index) * dx} ${point.x},${point.y}`;
    })
    .join(" ");
}
