import { buildRoute, sectionAt, type CourseJson, type Pt, type Route } from "../lib/geometry";
import type { TapNode, TapStep } from "../lib/tap";
import kogata from "./kogata.json";

export interface Course {
  id: string;
  name: string;
  image: string;
  originalImage: string;
  width: number;
  height: number;
  sections: Pt[][];
  route: Route;
  taps: TapStep[];
}

/** タップ候補と各コースの正解手順は tools/extract_course.py が地図の壁（島の縁・縁石）を見て作る */
interface DataJson {
  tapNodes: TapNode[];
  courses: (CourseJson & { taps: { node: number; s: number }[] })[];
}

const data = kogata as unknown as DataJson;

export const tapNodes: TapNode[] = data.tapNodes;

export const courses: Course[] = data.courses.map((c) => {
  const route = buildRoute(c.sections);
  return {
    ...c,
    image: import.meta.env.BASE_URL + c.image,
    originalImage: import.meta.env.BASE_URL + c.originalImage,
    route,
    taps: c.taps.map((t) => ({ ...t, section: sectionAt(route, Math.max(0, t.s - 1)) })),
  };
});
