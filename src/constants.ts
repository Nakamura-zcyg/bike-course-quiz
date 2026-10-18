// 座標の単位はすべてコース図の pt（PDF 座標を切り抜いたもの）

/**
 * なぞる判定の許容幅（ルートの線からの距離）。PDF の線は重なり回避で道の中心からずらして
 * 描かれている所があるため、「同じ道（領域）の上なら正解」になるよう道幅の半分＋ずれ分を見込む。
 */
export const TOLERANCE_PRESETS = {
  strict: { label: "厳しめ", value: 15 },
  normal: { label: "標準", value: 22 },
  loose: { label: "緩め", value: 28 },
} as const;
export type ToleranceKey = keyof typeof TOLERANCE_PRESETS;
export const DEFAULT_TOLERANCE: ToleranceKey = "normal";

/** なぞった線をこの間隔で補間してから判定する */
export const RESAMPLE_STEP = 2;
/** 許容幅の外にこの長さ続けて出たら外れとする（指のぶれで 1 点だけ出たのは見逃す） */
export const OFF_CONFIRM_LENGTH = 8;
/** 判定窓: 現在の進み位置から前方・後方どこまでを照合対象にするか（許容幅の倍数） */
export const LOOKAHEAD_FACTOR = 3;
export const LOOKBACK_FACTOR = 1.5;
/** 練習モードで指を離したあと、続きを描き始めてよい距離（許容幅の倍数） */
export const RESUME_FACTOR = 1.8;
/** 本番採点で、この長さを超えて飛ばした区間は未走行とみなす（許容幅の倍数） */
export const SKIP_FACTOR = 2;
/**
 * 本番採点でコースを外れたあと、ルートに戻ったとみなす条件。
 * 近く（許容幅の RESYNC_NEAR_FACTOR 倍以内の先）なら数点、遠く先なら長く沿ってなぞったときだけ。
 * 寄り道した道が「あとで通る道」と重なっていても、そこへ飛んだと誤認しないため。
 */
export const RESYNC_NEAR_FACTOR = 25;
export const RESYNC_CONFIRM_NEAR = 3;
export const RESYNC_CONFIRM_FAR = 40;

/** タップ候補（曲がり角）の抽出 */
export const CORNER_SIMPLIFY_EPS = 2.5;
export const CORNER_MIN_TURN_DEG = 25;
export const NODE_MERGE_RADIUS = 20;
export const NODE_MATCH_RADIUS = 18;
/** タップの当たり判定（画面上の px） */
export const TAP_HIT_PX = 28;

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.5;

/** 練習モードで正解区間を見せる時間 */
export const HINT_SHOW_MS = 1800;
/** お手本アニメーションの速さ（pt / 秒） */
export const DEMO_SPEED = 160;

export const STORAGE_PREFIX = "bike-course-quiz:v1:";
