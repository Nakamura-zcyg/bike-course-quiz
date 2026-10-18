import { ArrowLeft, Hand, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CourseMap } from "../components/CourseMap";
import { ArrowDefs, Line, NodeDots, SectionLabels, SectionPaths, StartMarker } from "../components/MapLayers";
import { DEMO_SPEED } from "../constants";
import { tapNodes, type Course } from "../data/courses";
import { pointAt, slice } from "../lib/geometry";
import { clearWeak, loadWeak } from "../lib/storage";

type Layer = "route" | "original" | "overlay";

const LAYERS: { key: Layer; label: string }[] = [
  { key: "route", label: "お手本" },
  { key: "original", label: "元の図" },
  { key: "overlay", label: "重ねて確認" },
];

interface Props {
  course: Course;
  onBack: () => void;
}

export function Review({ course, onBack }: Props) {
  const { route } = course;
  const [layer, setLayer] = useState<Layer>("route");
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

  const maxWeak = Math.max(0, ...weak);
  const weakClass = (i: number) => (weak[i] > 0 ? `route-weak weak-${Math.min(3, Math.ceil((weak[i] / maxWeak) * 3))}` : "route-ref");

  return (
    <div className="quiz">
      <div className="quiz-map">
        <CourseMap
          width={course.width}
          height={course.height}
          image={layer === "route" ? course.image : course.originalImage}
          interaction={pan ? "pan" : "none"}
        >
          <ArrowDefs />
          {layer === "route" && demoS === null && (
            <>
              <SectionPaths route={route} className={weakClass} arrows />
              <SectionLabels route={route} />
            </>
          )}
          {layer === "route" && demoS !== null && (
            <>
              <Line pts={slice(route, 0, demoS)} className="route-ref" />
              <circle className="demo-dot" cx={pointAt(route, demoS)[0]} cy={pointAt(route, demoS)[1]} r="5" />
            </>
          )}
          {layer === "overlay" && <SectionPaths route={route} className={() => "route-overlay"} />}
          {showNodes && <NodeDots nodes={tapNodes} />}
          <StartMarker route={route} />
        </CourseMap>
      </div>
      <aside className="quiz-panel">
        <div className="quiz-title">
          <strong>{course.name}</strong>
        </div>
        <div className="segmented" role="tablist">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={layer === l.key}
              className={layer === l.key ? "is-active" : ""}
              onClick={() => {
                setLayer(l.key);
                setPlaying(false);
                setDemoS(null);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        {layer === "route" && (
          <p className="muted small">
            {maxWeak > 0 ? "赤いほど間違えた回数が多い区間です。数字は区間番号。" : "数字は区間番号。矢印が進行方向です。"}
          </p>
        )}
        {layer === "overlay" && <p className="muted small">青線（アプリの正解データ）が元の赤線に重なっているかを確認できます。</p>}
        <div className="panel-buttons">
          {layer === "route" && (
            <button type="button" className="btn-primary" onClick={togglePlay}>
              {playing ? <Pause /> : <Play />} {playing ? "止める" : "走行順に再生"}
            </button>
          )}
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
