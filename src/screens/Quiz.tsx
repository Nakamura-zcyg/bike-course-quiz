import { BookOpen, Check, Eraser, Hand, Home, PenLine, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CourseMap, type Interaction } from "../components/CourseMap";
import {
  ArrowDefs,
  Line,
  NodeDots,
  ResumeMarker,
  SectionLabels,
  SectionPaths,
  StartMarker,
} from "../components/MapLayers";
import { HINT_SHOW_MS, TAP_HIT_PX } from "../constants";
import { tapNodes, type Course } from "../data/courses";
import { evaluateFreehand, LiveTracker } from "../lib/freehand";
import { dist, sectionAt, sectionEnd, slice, type Pt } from "../lib/geometry";
import { saveResult, type InputMode, type QuizMode } from "../lib/storage";
import { evaluateTaps, tapScore } from "../lib/tap";

interface Props {
  course: Course;
  input: InputMode;
  mode: QuizMode;
  tol: number;
  onRetry: () => void;
  onReview: () => void;
  onExit: () => void;
}

type Tone = "info" | "error" | "success";

interface Result {
  score: number;
  sectionErrors: boolean[];
  best: number;
  isBest: boolean;
  userPaths: Pt[][];
}

const MODE_LABEL: Record<QuizMode, string> = { practice: "練習", exam: "本番" };
const INPUT_LABEL: Record<InputMode, string> = { free: "なぞる", tap: "タップ" };

export function Quiz({ course, input, mode, tol, onRetry, onReview, onExit }: Props) {
  const { route } = course;
  const sectionCount = route.sectionStart.length;
  const nodeById = useMemo(() => new Map(tapNodes.map((n) => [n.id, n])), []);

  const [interaction, setInteraction] = useState<Interaction>("draw");
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({
    text: input === "free" ? "スタート地点（丸と矢印）からなぞってください" : "スタートの次に通る曲がり角をタップしてください",
    tone: "info",
  });
  const [result, setResult] = useState<Result | null>(null);
  const mistakes = useRef<number[]>(new Array(sectionCount).fill(0));

  // 練習モードで外れたときに一時表示するもの
  const [hint, setHint] = useState<Pt[] | null>(null);
  const [offStroke, setOffStroke] = useState<Pt[] | null>(null);
  const [wrongNode, setWrongNode] = useState<number | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);
  const flashHint = (pts: Pt[], stroke: Pt[] | null, node: number | null) => {
    setHint(pts);
    setOffStroke(stroke);
    setWrongNode(node);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      setHint(null);
      setOffStroke(null);
      setWrongNode(null);
    }, HINT_SHOW_MS);
  };

  const finish = (score: number, sectionErrors: boolean[], userPaths: Pt[][]) => {
    const perSection = mode === "practice" ? mistakes.current : sectionErrors.map((e) => (e ? 1 : 0));
    const { record, isBest } = saveResult(course.id, input, mode, score, perSection);
    setResult({ score, sectionErrors, best: record.best, isBest, userPaths });
    setInteraction("none");
  };

  // ---- なぞる ----
  const tracker = useRef(new LiveTracker(route, tol));
  const [progress, setProgress] = useState(0);
  const strokeRef = useRef<Pt[]>([]);
  const [stroke, setStrokeState] = useState<Pt[]>([]);
  const setStroke = (pts: Pt[]) => {
    strokeRef.current = pts;
    setStrokeState(pts);
  };
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const drawing = useRef(false);

  const freeDown = (p: Pt) => {
    if (mode === "practice" && !tracker.current.begin(p)) {
      setMessage({ text: "続きは緑の丸の位置から描いてください", tone: "error" });
      return;
    }
    drawing.current = true;
    setStroke([p]);
  };

  const freeMove = (p: Pt) => {
    if (!drawing.current) return;
    setStroke([...strokeRef.current, p]);
    if (mode === "exam") return;
    const r = tracker.current.move(p);
    setProgress(tracker.current.s);
    if (r.status === "ok") {
      const sec = sectionAt(route, tracker.current.s);
      setMessage({ text: `区間 ${sec + 1} / ${sectionCount}`, tone: "info" });
    } else if (r.status === "off") {
      drawing.current = false;
      mistakes.current[r.section]++;
      flashHint(slice(route, tracker.current.s, sectionEnd(route, r.section)), strokeRef.current, null);
      setStroke([]);
      setMessage({ text: `コースを外れました。区間 ${r.section + 1} の正しい道を表示します`, tone: "error" });
    } else {
      drawing.current = false;
      setStroke([]);
      const errors = mistakes.current.map((m) => m > 0);
      finish(Math.round((errors.filter((e) => !e).length / sectionCount) * 100), errors, []);
    }
  };

  const freeUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    tracker.current.end();
    if (mode === "exam") {
      const done = strokeRef.current;
      setStrokes((all) => [...all, done]);
    }
    setStroke([]);
  };

  // ---- タップ ----
  const [tapIdx, setTapIdx] = useState(0);
  const [tapped, setTapped] = useState<number[]>([]);

  const tapDown = (p: Pt, mapPerPx: number) => {
    let best: { id: number; d: number } | null = null;
    for (const n of tapNodes) {
      const d = dist(p, n.p);
      if (d <= TAP_HIT_PX * mapPerPx && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (!best) return;
    const id = best.id;
    if (mode === "exam") {
      setTapped((t) => (t[t.length - 1] === id ? t : [...t, id]));
      return;
    }
    const step = course.taps[tapIdx];
    if (id === step.node) {
      const next = tapIdx + 1;
      setTapIdx(next);
      if (next === course.taps.length) {
        const errors = mistakes.current.map((m) => m > 0);
        finish(tapScore(course.taps, errors), errors, []);
      } else {
        setMessage({ text: `正解。あと ${course.taps.length - next} か所`, tone: "success" });
      }
      return;
    }
    mistakes.current[step.section]++;
    const prevS = tapIdx > 0 ? course.taps[tapIdx - 1].s : 0;
    flashHint(slice(route, prevS, step.s), null, id);
    setMessage({ text: "違います。次に通る道を表示します", tone: "error" });
  };

  const tapPath: Pt[] = [route.points[0], ...tapped.map((id) => nodeById.get(id)!.p)];

  const grade = () => {
    if (input === "free") {
      const r = evaluateFreehand(route, strokes, tol);
      finish(r.score, r.sectionErrors, strokes);
    } else {
      const r = evaluateTaps(course.taps, tapped, sectionCount);
      finish(r.score, r.sectionErrors, [tapPath]);
    }
  };

  const undo = () => (input === "free" ? setStrokes((s) => s.slice(0, -1)) : setTapped((t) => t.slice(0, -1)));
  const clearAll = () => (input === "free" ? setStrokes([]) : setTapped([]));
  const canUndo = input === "free" ? strokes.length > 0 : tapped.length > 0;

  const tapDone = tapIdx > 0 ? course.taps[tapIdx - 1].s : 0;

  return (
    <div className="quiz">
      <div className="quiz-map">
        <CourseMap
          width={course.width}
          height={course.height}
          image={course.image}
          interaction={interaction}
          onDown={input === "free" ? freeDown : tapDown}
          onMove={input === "free" ? freeMove : undefined}
          onUp={input === "free" ? freeUp : undefined}
        >
          <ArrowDefs />
          {result ? (
            <>
              <SectionPaths route={route} className={(i) => (result.sectionErrors[i] ? "route-ng" : "route-ok")} arrows />
              {result.userPaths.map((pts, i) => (
                <Line key={i} pts={pts} className="user-path is-faint" />
              ))}
              <SectionLabels route={route} only={(i) => result.sectionErrors[i]} />
            </>
          ) : (
            <>
              {input === "tap" && (
                <NodeDots
                  nodes={tapNodes}
                  className={(n) => (n.id === wrongNode ? "is-wrong" : undefined)}
                />
              )}
              {mode === "practice" && input === "free" && <Line pts={slice(route, 0, progress)} className="route-done" />}
              {mode === "practice" && input === "tap" && <Line pts={slice(route, 0, tapDone)} className="route-done" />}
              {mode === "exam" && input === "free" && strokes.map((s, i) => <Line key={i} pts={s} className="user-path" />)}
              {mode === "exam" && input === "tap" && <Line pts={tapPath} className="user-path" />}
              {hint && <Line pts={hint} className="route-hint" arrow />}
              {offStroke && <Line pts={offStroke} className="user-path is-off" />}
              <Line pts={stroke} className="user-path" />
              <StartMarker route={route} />
              {mode === "practice" && input === "free" && progress > 0 && (
                <ResumeMarker p={tracker.current.resumePoint} />
              )}
            </>
          )}
        </CourseMap>
      </div>

      <aside className="quiz-panel">
        <div className="quiz-title">
          <strong>{course.name}</strong>
          <span className="chip">{INPUT_LABEL[input]}</span>
          <span className="chip">{MODE_LABEL[mode]}</span>
        </div>

        {result ? (
          <div className="result">
            <div className="score">
              <span className="score-value">{result.score}</span>
              <span className="score-unit">点</span>
            </div>
            <p className="muted">{result.isBest ? "ベストスコア更新" : `ベスト ${result.best} 点`}</p>
            <p className={result.sectionErrors.some((e) => e) ? "msg-error" : "msg-success"}>
              {result.sectionErrors.some((e) => e)
                ? `間違えた区間: ${result.sectionErrors.flatMap((e, i) => (e ? [i + 1] : [])).join(", ")}`
                : "全区間正解"}
            </p>
            <div className="panel-buttons">
              <button type="button" className="btn-primary" onClick={onRetry}>
                <RotateCcw /> もう一度
              </button>
              <button type="button" onClick={onReview}>
                <BookOpen /> お手本
              </button>
              <button type="button" onClick={onExit}>
                <Home /> メニュー
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className={`status msg-${message.tone}`}>{message.text}</p>
            <div className="panel-buttons">
              <button
                type="button"
                className={interaction === "pan" ? "is-active" : ""}
                onClick={() => setInteraction((m) => (m === "pan" ? "draw" : "pan"))}
              >
                {interaction === "pan" ? <PenLine /> : <Hand />}
                {interaction === "pan" ? (input === "free" ? "なぞりに戻る" : "タップに戻る") : "拡大・移動"}
              </button>
              {mode === "exam" && (
                <>
                  <button type="button" onClick={undo} disabled={!canUndo}>
                    <Undo2 /> 1つ戻す
                  </button>
                  <button type="button" onClick={clearAll} disabled={!canUndo}>
                    <Eraser /> 全部消す
                  </button>
                  <button type="button" className="btn-primary" onClick={grade} disabled={!canUndo}>
                    <Check /> 採点する
                  </button>
                </>
              )}
              <button type="button" onClick={onExit}>
                <Home /> やめる
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
