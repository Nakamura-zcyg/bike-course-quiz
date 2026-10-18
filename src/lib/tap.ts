import {
  CORNER_MIN_TURN_DEG,
  CORNER_SIMPLIFY_EPS,
  NODE_MATCH_RADIUS,
  NODE_MERGE_RADIUS,
} from "../constants";
import { dist, sectionAt, type Pt, type Route } from "./geometry";

export interface TapNode {
  id: number;
  p: Pt;
}

export interface TapStep {
  node: number;
  s: number;
  section: number;
}

function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = dist(a, b) || 1e-9;
  let dmax = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

function turnDeg(a: Pt, b: Pt, c: Pt) {
  const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  const d = Math.abs(((t2 - t1) * 180) / Math.PI) % 360;
  return Math.min(d, 360 - d);
}

/**
 * タップ候補 = 全コースの曲がり角を近いもの同士でまとめた点。
 * 1 コース分の曲がり角だけだと候補そのものが答えになるため、全コースの分を混ぜる。
 */
export function buildNodes(routes: Route[]): TapNode[] {
  const clusters: { sum: Pt; n: number }[] = [];
  const add = (p: Pt) => {
    const c = clusters.find((k) => dist([k.sum[0] / k.n, k.sum[1] / k.n], p) <= NODE_MERGE_RADIUS);
    if (c) {
      c.sum = [c.sum[0] + p[0], c.sum[1] + p[1]];
      c.n++;
    } else clusters.push({ sum: [p[0], p[1]], n: 1 });
  };
  for (const route of routes) {
    const simp = simplify(route.points, CORNER_SIMPLIFY_EPS);
    for (let i = 1; i < simp.length - 1; i++) {
      if (turnDeg(simp[i - 1], simp[i], simp[i + 1]) >= CORNER_MIN_TURN_DEG) add(simp[i]);
    }
    add(route.points[route.points.length - 1]);
  }
  return clusters.map((c, id) => ({ id, p: [c.sum[0] / c.n, c.sum[1] / c.n] as Pt }));
}

/** ルートを 1pt ずつたどり、各地点で最寄りの候補点（半径内）が切り替わるたびに 1 手として記録する */
export function expectedTaps(route: Route, nodes: TapNode[]): TapStep[] {
  const steps: TapStep[] = [];
  let cur: { node: number; s: number; d: number } | null = null;
  const flush = () => {
    if (!cur) return;
    if (steps[steps.length - 1]?.node !== cur.node) {
      steps.push({ node: cur.node, s: cur.s, section: sectionAt(route, Math.max(0, cur.s - 1)) });
    }
    cur = null;
  };
  for (let s = 0; s <= route.total; s += 1) {
    const p = pointAtFast(route, s);
    let best: { node: number; d: number } | null = null;
    for (const n of nodes) {
      const d = dist(p, n.p);
      if (d <= NODE_MATCH_RADIUS && (!best || d < best.d)) best = { node: n.id, d };
    }
    if (!best) {
      flush();
      continue;
    }
    if (cur && cur.node !== best.node) flush();
    if (!cur) cur = { node: best.node, s, d: best.d };
    else if (best.d < cur.d) cur = { node: best.node, s, d: best.d };
  }
  flush();
  // スタート地点は最初から示しているので、出発直後にスタート地点の候補を通るぶんは数えない
  const start = route.points[0];
  while (steps.length && dist(nodes[steps[0].node].p, start) <= NODE_MATCH_RADIUS && steps[0].s <= NODE_MATCH_RADIUS * 2) {
    steps.shift();
  }
  return steps;
}

function pointAtFast(route: Route, s: number): Pt {
  const { points, s: S } = route;
  let lo = 1;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (S[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo - 1];
  const b = points[lo];
  const t = Math.min(1, Math.max(0, (s - S[lo - 1]) / (S[lo] - S[lo - 1] || 1)));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export interface TapResult {
  sectionErrors: boolean[];
  matched: boolean[];
  score: number;
}

/** 本番モード: 正解の手順とタップ列の最長共通部分列で照合する */
export function evaluateTaps(expected: TapStep[], taps: number[], sectionCount: number): TapResult {
  const m = expected.length;
  const n = taps.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = expected[i].node === taps[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array<boolean>(m).fill(false);
  const errors = new Array<boolean>(sectionCount).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (expected[i].node === taps[j]) {
      matched[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      errors[expected[i].section] = true;
      i++;
    } else {
      // 余計なタップは、次に通るべき地点の区間の誤りとする
      errors[expected[Math.min(i, m - 1)].section] = true;
      j++;
    }
  }
  for (; i < m; i++) errors[expected[i].section] = true;
  if (j < n && m) errors[expected[m - 1].section] = true;
  return { sectionErrors: errors, matched, score: tapScore(expected, errors) };
}

/** タップ地点を 1 つも含まない区間は問いようがないので、採点の分母から外す */
export function tapScore(expected: TapStep[], sectionErrors: boolean[]): number {
  const asked = [...new Set(expected.map((e) => e.section))];
  const ok = asked.filter((i) => !sectionErrors[i]).length;
  return asked.length ? Math.round((ok / asked.length) * 100) : 0;
}
