export type Pt = [number, number];

export interface CourseJson {
  id: string;
  name: string;
  image: string;
  originalImage: string;
  width: number;
  height: number;
  sections: Pt[][];
}

/** 区間を連結した 1 本の折れ線と、各点までの道のり s */
export interface Route {
  points: Pt[];
  s: number[];
  sectionStart: number[];
  total: number;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function buildRoute(sections: Pt[][]): Route {
  const points: Pt[] = [];
  const s: number[] = [];
  const sectionStart: number[] = [];
  for (const sec of sections) {
    // 前区間の終点（矢じり）から次区間の始点までのすき間は次区間に含める
    sectionStart.push(s.length ? s[s.length - 1] : 0);
    for (const p of sec) {
      const prev = points[points.length - 1];
      if (prev && dist(prev, p) < 1e-6) continue;
      s.push(prev ? s[s.length - 1] + dist(prev, p) : 0);
      points.push(p);
    }
  }
  return { points, s, sectionStart, total: s[s.length - 1] };
}

export function sectionAt(route: Route, s: number): number {
  let lo = 0;
  let hi = route.sectionStart.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (route.sectionStart[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function sectionEnd(route: Route, i: number): number {
  return i + 1 < route.sectionStart.length ? route.sectionStart[i + 1] : route.total;
}

export function pointAt(route: Route, s: number): Pt {
  const { points, s: S } = route;
  if (s <= 0) return points[0];
  if (s >= route.total) return points[points.length - 1];
  let i = 1;
  while (S[i] < s) i++;
  const t = (s - S[i - 1]) / (S[i] - S[i - 1] || 1);
  const a = points[i - 1];
  const b = points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 道のり s0〜s1 の部分折れ線 */
export function slice(route: Route, s0: number, s1: number): Pt[] {
  const a = Math.max(0, Math.min(s0, s1));
  const b = Math.min(route.total, Math.max(s0, s1));
  const out: Pt[] = [pointAt(route, a)];
  for (let i = 0; i < route.points.length; i++) {
    if (route.s[i] > a && route.s[i] < b) out.push(route.points[i]);
  }
  out.push(pointAt(route, b));
  return out;
}

/** 進行方向（ラジアン） */
export function headingAt(route: Route, s: number): number {
  const a = pointAt(route, s);
  const b = pointAt(route, s + 8);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

export interface Projection {
  s: number;
  d: number;
}

/**
 * 道のり [sMin, sMax] の範囲だけでルートに射影する。
 * mode="nearest" は最も近い点、"earliest" は許容幅 tol 以内で最も手前の点を返す。
 */
export function project(
  route: Route,
  p: Pt,
  sMin: number,
  sMax: number,
  mode: "nearest" | "earliest" = "nearest",
  tol = Infinity,
): Projection | null {
  const { points, s: S } = route;
  let best: Projection | null = null;
  for (let i = 1; i < points.length; i++) {
    const s0 = S[i - 1];
    const s1 = S[i];
    if (s1 < sMin || s0 > sMax) continue;
    const a = points[i - 1];
    const b = points[i];
    const len = s1 - s0 || 1e-9;
    let t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
    const tMin = Math.max(0, (sMin - s0) / len);
    const tMax = Math.min(1, (sMax - s0) / len);
    t = Math.max(tMin, Math.min(tMax, t));
    const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = dist(p, q);
    const cand = { s: s0 + len * t, d };
    if (mode === "earliest") {
      if (d <= tol) return cand;
    } else if (!best || d < best.d) {
      best = cand;
    }
  }
  return best;
}

/** 前の点から次の点までを step 間隔で補間した点列（前の点は含まない） */
export function interpolate(from: Pt | null, to: Pt, step: number): Pt[] {
  if (!from) return [to];
  const d = dist(from, to);
  const n = Math.max(1, Math.ceil(d / step));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    out.push([from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n]);
  }
  return out;
}

export const toPath = (pts: Pt[]) =>
  pts.length ? "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L") : "";
