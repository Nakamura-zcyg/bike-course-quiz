import {
  LOOKAHEAD_FACTOR,
  LOOKBACK_FACTOR,
  OFF_CONFIRM_LENGTH,
  RESAMPLE_STEP,
  RESUME_FACTOR,
  RESYNC_CONFIRM_FAR,
  RESYNC_CONFIRM_NEAR,
  RESYNC_NEAR_FACTOR,
  SKIP_FACTOR,
} from "../constants";
import { dist, interpolate, pointAt, project, sectionAt, type Pt, type Route } from "./geometry";

/**
 * 判定の考え方: ルート上の「進み位置 s」を持ち、描いた点を s の少し手前〜少し先の範囲だけで照合する。
 * 範囲を絞るので、交差点や同じ道を 2 回通る区間でも「今どの周回のどこか」を取り違えず、
 * 逆走（s が戻る）や先の区間へのショートカットは許容幅外として外れ判定になる。
 */
const windowOf = (tol: number) => ({ ahead: tol * LOOKAHEAD_FACTOR, back: tol * LOOKBACK_FACTOR });

/** 外れた地点の「本来進むべき区間」。区間の終わり際で曲がり損ねたら次の区間の誤りとする */
const blameSection = (route: Route, s: number, tol: number) => sectionAt(route, Math.min(route.total, s + tol));

export type MoveResult = { status: "ok" } | { status: "done" } | { status: "off"; at: Pt; section: number };

/** 練習モード: 外れた瞬間に止める */
export class LiveTracker {
  s = 0;
  private last: Pt | null = null;
  private offRun = 0;
  private readonly route: Route;
  private readonly tol: number;

  constructor(route: Route, tol: number) {
    this.route = route;
    this.tol = tol;
  }

  get done() {
    return this.s >= this.route.total - this.tol;
  }

  get resumePoint(): Pt {
    return pointAt(this.route, this.s);
  }

  /** 続きの位置の近くから描き始めたときだけ受け付ける */
  begin(p: Pt): boolean {
    if (dist(p, this.resumePoint) > this.tol * RESUME_FACTOR) return false;
    this.last = p;
    return true;
  }

  move(p: Pt): MoveResult {
    if (!this.last) return { status: "ok" };
    const { ahead, back } = windowOf(this.tol);
    for (const q of interpolate(this.last, p, RESAMPLE_STEP)) {
      const r = project(this.route, q, this.s - back, this.s + ahead);
      if (!r || r.d > this.tol) {
        this.offRun += RESAMPLE_STEP;
        if (this.offRun < OFF_CONFIRM_LENGTH) continue;
        this.offRun = 0;
        this.last = null;
        return { status: "off", at: q, section: blameSection(this.route, this.s, this.tol) };
      }
      this.offRun = 0;
      this.s = Math.max(this.s, r.s);
      if (this.done) {
        this.last = null;
        return { status: "done" };
      }
    }
    this.last = p;
    return { status: "ok" };
  }

  end() {
    this.last = null;
    this.offRun = 0;
  }
}

export interface FreehandResult {
  sectionErrors: boolean[];
  offPoints: Pt[];
  reached: number;
  score: number;
}

/** 本番モード: 描き終えた全ストロークをまとめて採点する */
export function evaluateFreehand(route: Route, strokes: Pt[][], tol: number): FreehandResult {
  const n = route.sectionStart.length;
  const errors = new Array<boolean>(n).fill(false);
  const offPoints: Pt[] = [];
  const { ahead, back } = windowOf(tol);
  const markRange = (s0: number, s1: number) => {
    for (let i = blameSection(route, s0, tol); i <= sectionAt(route, Math.max(s0, s1 - tol)); i++) errors[i] = true;
  };

  let s = 0;
  let lost = false;
  let offRun = 0;
  // 外れている間の「ここでルートに戻ったかもしれない」候補。start は戻った地点、s はそこから追跡した位置
  type Candidate = { start: number; s: number; count: number; far: boolean };
  let cand: Candidate | null = null;
  const findCandidate = (q: Pt): Candidate | null => {
    const nearEnd = s + tol * RESYNC_NEAR_FACTOR;
    const near = project(route, q, s - back, nearEnd, "earliest", tol);
    if (near) return { start: near.s, s: near.s, count: 1, far: false };
    const far = project(route, q, nearEnd, route.total, "earliest", tol);
    return far ? { start: far.s, s: far.s, count: 1, far: true } : null;
  };

  for (const stroke of strokes) {
    let last: Pt | null = null;
    for (const p of stroke) {
      for (const q of interpolate(last, p, RESAMPLE_STEP)) {
        if (!lost) {
          const r = project(route, q, s - back, s + ahead);
          if (r && r.d <= tol) {
            s = Math.max(s, r.s);
            offRun = 0;
            continue;
          }
          offRun += RESAMPLE_STEP;
          if (offRun < OFF_CONFIRM_LENGTH) continue;
          offRun = 0;
          lost = true;
          cand = null;
          errors[blameSection(route, s, tol)] = true;
          offPoints.push(q);
          continue;
        }
        if (cand) {
          const r = project(route, q, cand.s - back, cand.s + ahead);
          const nearNow: Candidate | null = cand.far ? findCandidate(q) : null;
          if (nearNow && !nearNow.far) cand = nearNow;
          else if (r && r.d <= tol) {
            cand.s = Math.max(cand.s, r.s);
            cand.count++;
          } else cand = findCandidate(q);
        } else {
          cand = findCandidate(q);
        }
        if (cand && cand.count >= (cand.far ? RESYNC_CONFIRM_FAR : RESYNC_CONFIRM_NEAR)) {
          // 飛ばした区間は未走行として誤り
          if (cand.start - s > tol * SKIP_FACTOR) markRange(s, cand.start);
          s = Math.max(s, cand.s);
          lost = false;
          cand = null;
        } else {
          offPoints.push(q);
        }
      }
      last = p;
    }
  }
  if (s < route.total - tol * SKIP_FACTOR) markRange(s, route.total + tol);

  const ok = errors.filter((e) => !e).length;
  return { sectionErrors: errors, offPoints, reached: s, score: Math.round((ok / n) * 100) };
}
