import { useState } from "react";
import { TOLERANCE_PRESETS } from "./constants";
import type { Course } from "./data/courses";
import { loadSettings, saveSettings, type Settings } from "./lib/storage";
import { HomeScreen } from "./screens/Home";
import { Quiz } from "./screens/Quiz";
import { Review } from "./screens/Review";

type Screen = { kind: "home" } | { kind: "quiz"; course: Course; run: number } | { kind: "review"; course: Course };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [screen, setScreen] = useState<Screen>({ kind: "home" });

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };
  const home = () => setScreen({ kind: "home" });

  if (screen.kind === "quiz") {
    const { course, run } = screen;
    return (
      <Quiz
        key={run}
        course={course}
        input={settings.input}
        mode={settings.mode}
        tol={TOLERANCE_PRESETS[settings.tolerance].value}
        onRetry={() => setScreen({ kind: "quiz", course, run: run + 1 })}
        onReview={() => setScreen({ kind: "review", course })}
        onExit={home}
      />
    );
  }
  if (screen.kind === "review") {
    return <Review course={screen.course} onBack={home} />;
  }
  return (
    <HomeScreen
      settings={settings}
      onSettings={updateSettings}
      onStart={(course) => setScreen({ kind: "quiz", course, run: 0 })}
      onReview={(course) => setScreen({ kind: "review", course })}
    />
  );
}
