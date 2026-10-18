import { BookOpen, Play } from "lucide-react";
import { TOLERANCE_PRESETS, type ToleranceKey } from "../constants";
import { courses, type Course } from "../data/courses";
import { loadRecord, loadWeak, type InputMode, type QuizMode, type Settings } from "../lib/storage";

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  onStart: (c: Course) => void;
  onReview: (c: Course) => void;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string; note?: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.key === value);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={o.key === value ? "is-active" : ""}
            aria-pressed={o.key === value}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current?.note && <span className="muted small">{current.note}</span>}
    </div>
  );
}

const INPUT_OPTIONS: { key: InputMode; label: string; note: string }[] = [
  { key: "free", label: "なぞる", note: "指で道をなぞる" },
  { key: "tap", label: "タップ", note: "通る曲がり角を順にタップする" },
];
const MODE_OPTIONS: { key: QuizMode; label: string; note: string }[] = [
  { key: "practice", label: "練習", note: "外れたらその場で正しい道を表示" },
  { key: "exam", label: "本番", note: "最後まで描いてからまとめて採点" },
];
const TOL_OPTIONS = (Object.keys(TOLERANCE_PRESETS) as ToleranceKey[]).map((key) => ({
  key,
  label: TOLERANCE_PRESETS[key].label,
}));

export function HomeScreen({ settings, onSettings, onStart, onReview }: Props) {
  return (
    <div className="home">
      <header className="home-header">
        <h1>技能試験コース暗記</h1>
        <p className="muted small">コース図をなぞって順路を覚える。横向き推奨。</p>
      </header>

      <section className="settings">
        <Segmented label="入力方式" value={settings.input} options={INPUT_OPTIONS} onChange={(input) => onSettings({ ...settings, input })} />
        <Segmented label="モード" value={settings.mode} options={MODE_OPTIONS} onChange={(mode) => onSettings({ ...settings, mode })} />
        {settings.input === "free" && (
          <Segmented
            label="判定の厳しさ"
            value={settings.tolerance}
            options={TOL_OPTIONS}
            onChange={(tolerance) => onSettings({ ...settings, tolerance })}
          />
        )}
      </section>

      <section className="course-list">
        {courses.map((c) => {
          const rec = loadRecord(c.id, settings.input, settings.mode);
          const weak = loadWeak(c.id, c.route.sectionStart.length).filter((w) => w > 0).length;
          return (
            <article key={c.id} className="course-card">
              <img src={c.image} alt={`${c.name}のコース図`} loading="lazy" />
              <div className="course-card-body">
                <h2>{c.name}</h2>
                <p className="muted small">
                  {rec ? `挑戦 ${rec.attempts} 回 / ベスト ${rec.best} 点 / 前回 ${rec.last} 点` : "まだ挑戦していません"}
                  {weak > 0 && ` / 苦手 ${weak} 区間`}
                </p>
                <div className="card-buttons">
                  <button type="button" className="btn-primary" onClick={() => onStart(c)}>
                    <Play /> スタート
                  </button>
                  <button type="button" onClick={() => onReview(c)}>
                    <BookOpen /> お手本
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
