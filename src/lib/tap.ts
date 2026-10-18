import type { Pt } from "./geometry";

/** タップ候補。pole は番号ポール（交差点）の番号、ポールのない曲がり角は null */
export interface TapNode {
  id: number;
  p: Pt;
  pole: number | null;
}

export interface TapStep {
  node: number;
  s: number;
  section: number;
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
