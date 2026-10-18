import { DEFAULT_TOLERANCE, STORAGE_PREFIX, TOLERANCE_PRESETS, type ToleranceKey } from "../constants";

export type InputMode = "free" | "tap";
export type QuizMode = "practice" | "exam";

export interface Settings {
  tolerance: ToleranceKey;
  input: InputMode;
  mode: QuizMode;
}

export interface RecordEntry {
  attempts: number;
  best: number;
  last: number;
  lastAt: string;
}

const DEFAULT_SETTINGS: Settings = { tolerance: DEFAULT_TOLERANCE, input: "free", mode: "practice" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.error("localStorage read failed:", key, err);
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.error("localStorage write failed:", key, err);
  }
}

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) };
  if (!(s.tolerance in TOLERANCE_PRESETS)) s.tolerance = DEFAULT_TOLERANCE;
  return s;
}

export const saveSettings = (s: Settings) => write("settings", s);

const recordKey = (courseId: string, input: InputMode, mode: QuizMode) => `record:${courseId}:${input}:${mode}`;

export const loadRecord = (courseId: string, input: InputMode, mode: QuizMode) =>
  read<RecordEntry | null>(recordKey(courseId, input, mode), null);

/** 区間ごとの通算ミス回数（入力方式・モードをまたいで合算） */
export const loadWeak = (courseId: string, sectionCount: number): number[] => {
  const w = read<number[]>(`weak:${courseId}`, []);
  return Array.from({ length: sectionCount }, (_, i) => w[i] ?? 0);
};

export function saveResult(
  courseId: string,
  input: InputMode,
  mode: QuizMode,
  score: number,
  sectionMistakes: number[],
): { record: RecordEntry; isBest: boolean } {
  const prev = loadRecord(courseId, input, mode);
  const record: RecordEntry = {
    attempts: (prev?.attempts ?? 0) + 1,
    best: Math.max(prev?.best ?? 0, score),
    last: score,
    lastAt: new Date().toISOString(),
  };
  write(recordKey(courseId, input, mode), record);
  const weak = loadWeak(courseId, sectionMistakes.length).map((v, i) => v + sectionMistakes[i]);
  write(`weak:${courseId}`, weak);
  return { record, isBest: !prev || score > prev.best };
}

export function clearWeak(courseId: string) {
  write(`weak:${courseId}`, []);
}
