import { ArrowLeft, Hand, Pause, Play, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CourseMap } from "../components/CourseMap";
import { ArrowDefs, Line, NodeDots, SectionLabels, SectionPaths, StartMarker } from "../components/MapLayers";
import { DEMO_SPEED } from "../constants";
import { tapNodes, type Course } from "../data/courses";
import { pointAt, sectionAt, slice } from "../lib/geometry";
import { clearWeak, loadWeak } from "../lib/storage";

interface Props {
  course: Course;
  onBack: () => void;
}

export function Review({ course, onBack }: Props) {
  const { route } = course;
  const [showNodes, setShowNodes] = useState(false);
  const [pan, setPan] = useState(false);
  const [weak, setWeak] = useState(() => loadWeak(course.id, route.sectionStart.length));
  const [demoS, setDemoS] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setDemoS((s) => Math.min(route.total, (s ?? 0) + dt * DEMO_SPEED));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, route.total]);

  useEffect(() => {
    if (demoS !== null && demoS >= route.total) setPlaying(false);
  }, [demoS, route.total]);

  const togglePlay = () => {
    if (playing) setPlaying(false);
    else {
      if (demoS === null || demoS >= route.total) setDemoS(0);
      setPlaying(true);
    }
  };

  const stopDemo = () => {
    setPlaying(false);
    setDemoS(null);
  };

  const maxWeak = Math.max(0, ...weak);
  const weakClass = (i: number) => (weak[i] > 0 ? `route-weak weak-${Math.min(3, Math.ceil((weak[i] / maxWeak) * 3))}` : "route-ref");

  return (
    <div className="quiz">
      <div className="quiz-map">
        <CourseMap
          width={course.width}
          height={course.height}
          image={course.image}
          interaction={pan ? "pan" : "none"}
        >
          <ArrowDefs />
          {demoS === null && (
            <>
              <SectionPaths route={route} className={weakClass} arrows />
              <SectionLabels route={route} />
            </>
          )}
          {demoS !== null && (
            <>
              <Line pts={slice(route, 0, demoS)} className="route-ref" />
              <circle className="demo-dot" cx={pointAt(route, demoS)[0]} cy={pointAt(route, demoS)[1]} r="5" />
            </>
          )}
          {showNodes && <NodeDots nodes={tapNodes} />}
          <StartMarker route={route} />
        </CourseMap>
      </div>
      <aside className="quiz-panel">
        <div className="quiz-title">
          <strong>{course.name}</strong>
        </div>
        <p className="muted small">
          {maxWeak > 0 ? "赤いほど間違えた回数が多い区間です。数字は区間番号。" : "数字は区間番号。矢印が進行方向です。"}
        </p>
        <div className="panel-buttons">
          <button type="button" className="btn-primary" onClick={togglePlay}>
            {playing ? <Pause /> : <Play />} {playing ? "止める" : "走行順に再生"}
          </button>
          <div className="seek">
            {/* 再生中に動かしてもそのまま続きから再生する。止まっているときはその位置まで表示する */}
            <input
              type="range"
              min={0}
              max={route.total}
              step="any"
              value={demoS ?? 0}
              aria-label="再生位置"
              onChange={(e) => setDemoS(Number(e.target.value))}
            />
            <div className="seek-info">
              <span className="muted small">
                区間 {sectionAt(route, demoS ?? 0) + 1} / {route.sectionStart.length}
              </span>
              {demoS !== null && (
                <button type="button" className="seek-close" onClick={stopDemo}>
                  <X /> 全体表示
                </button>
              )}
            </div>
          </div>
          <button type="button" className={pan ? "is-active" : ""} onClick={() => setPan((p) => !p)}>
            <Hand /> 拡大・移動
          </button>
          <label className="check">
            <input type="checkbox" checked={showNodes} onChange={(e) => setShowNodes(e.target.checked)} />
            タップ候補を表示
          </label>
          {maxWeak > 0 && (
            <button
              type="button"
              onClick={() => {
                clearWeak(course.id);
                setWeak(loadWeak(course.id, route.sectionStart.length));
              }}
            >
              <Trash2 /> 苦手記録を消す
            </button>
          )}
          <button type="button" onClick={onBack}>
            <ArrowLeft /> 戻る
          </button>
        </div>
      </aside>
    </div>
  );
}
