import { buildRoute, type CourseJson, type Pt, type Route } from "../lib/geometry";
import { buildNodes, expectedTaps, type TapNode, type TapStep } from "../lib/tap";
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

const raw = (kogata as { courses: CourseJson[] }).courses;
const routes = raw.map((c) => buildRoute(c.sections));

/** 全コース共通のタップ候補（コース図は同じなので共有する） */
export const tapNodes: TapNode[] = buildNodes(routes);

export const courses: Course[] = raw.map((c, i) => ({
  ...c,
  image: import.meta.env.BASE_URL + c.image,
  originalImage: import.meta.env.BASE_URL + c.originalImage,
  route: routes[i],
  taps: expectedTaps(routes[i], tapNodes),
}));
