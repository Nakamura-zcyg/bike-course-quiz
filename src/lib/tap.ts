import { STRAIGHT_TOL } from "../constants";
import { slice, type Pt, type Route } from "./geometry";

/** タップ候補。pole は番号ポール（交差点）の番号、task はクランク・S 字の中ほどの代表点 */
export interface TapNode {
  id: number;
  p: Pt;
  pole: number | null;
  task: string | null;
}

export interface TapStep {
  node: number;
  s: number;
  section: number;
  /** 前の手から次の手までルートがまっすぐ通り抜けるだけの点。飛ばしてタップしてよい */
  optional: boolean;
}

/** 道のり s0〜s1 のルートが直線（弦からのずれが STRAIGHT_TOL 以内）か */
export function isStraight(route: Route, s0: number, s1: number): boolean {
  const pts = slice(route, s0, s1);
  const a = pts[0];
  const b = pts[pts.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return true;
  return pts.every((p) => Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / len <= STRAIGHT_TOL);
}

export function markOptional(route: Route, steps: Omit<TapStep, "optional">[]): TapStep[] {
  return steps.map((st, i) => ({
    ...st,
    optional: i < steps.length - 1 && isStraight(route, i > 0 ? steps[i - 1].s : 0, steps[i + 1].s),
  }));
}

/**
 * 練習モード: idx 手目を待っているときに node をタップしたら、何手目まで進んだことになるか。
 * 間の手がすべて直線で通り抜けるだけの点なら、飛ばして先をタップしてよい（本番の採点と同じ基準）。
 * 当てはまらなければ -1
 */
export function advanceTo(steps: TapStep[], idx: number, node: number): number {
  for (let j = idx; j < steps.length; j++) {
    if (steps[j].node === node) return j;
    if (!steps[j].optional) break;
  }
  return -1;
}

export interface TapResult {
  sectionErrors: boolean[];
  matched: boolean[];
  score: number;
}

/**
 * 本番モード: 正解の手順とタップ列を編集距離で照合する。
 * 手を飛ばす・余計にタップするのは 1 ずつの誤り。ただし直線で通り抜けるだけの手（optional）は飛ばしても誤りにしない
 */
export function evaluateTaps(expected: TapStep[], taps: number[], sectionCount: number): TapResult {
  const m = expected.length;
  const n = taps.length;
  const skipCost = (i: number) => (expected[i].optional ? 0 : 1);
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m; i >= 0; i--) {
    for (let j = n; j >= 0; j--) {
      if (i === m && j === n) continue;
      let best = Infinity;
      if (i < m && j < n && expected[i].node === taps[j]) best = dp[i + 1][j + 1];
      if (i < m) best = Math.min(best, dp[i + 1][j] + skipCost(i));
      if (j < n) best = Math.min(best, dp[i][j + 1] + 1);
      dp[i][j] = best;
    }
  }
  const matched = new Array<boolean>(m).fill(false);
  const errors = new Array<boolean>(sectionCount).fill(false);
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && expected[i].node === taps[j] && dp[i][j] === dp[i + 1][j + 1]) {
      matched[i] = true;
      i++;
      j++;
    } else if (i < m && dp[i][j] === dp[i + 1][j] + skipCost(i)) {
      if (!expected[i].optional) errors[expected[i].section] = true;
      i++;
    } else {
      // 余計なタップは、次に通るべき地点の区間の誤りとする
      if (m) errors[expected[Math.min(i, m - 1)].section] = true;
      j++;
    }
  }
  return { sectionErrors: errors, matched, score: tapScore(expected, errors) };
}

/** タップ地点を 1 つも含まない区間は問いようがないので、採点の分母から外す */
export function tapScore(expected: TapStep[], sectionErrors: boolean[]): number {
  const asked = [...new Set(expected.map((e) => e.section))];
  const ok = asked.filter((i) => !sectionErrors[i]).length;
  return asked.length ? Math.round((ok / asked.length) * 100) : 0;
}
