import { headingAt, pointAt, sectionEnd, slice, toPath, type Pt, type Route } from "../lib/geometry";
import type { TapNode } from "../lib/tap";

export function ArrowDefs() {
  return (
    <defs>
      <marker
        id="arrow-head"
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="9"
        markerHeight="9"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
      </marker>
    </defs>
  );
}

export function Line({ pts, className, arrow }: { pts: Pt[]; className: string; arrow?: boolean }) {
  if (pts.length < 2) return null;
  return <path d={toPath(pts)} className={className} markerEnd={arrow ? "url(#arrow-head)" : undefined} />;
}

/** スタート地点と最初の進行方向 */
export function StartMarker({ route }: { route: Route }) {
  const [x, y] = route.points[0];
  const deg = (headingAt(route, 0) * 180) / Math.PI;
  return (
    <g className="start-marker" transform={`translate(${x} ${y}) rotate(${deg})`}>
      <circle r="5" />
      <path d="M8,-5 L18,0 L8,5 z" />
    </g>
  );
}

export function ResumeMarker({ p }: { p: Pt }) {
  return <circle className="resume-marker" cx={p[0]} cy={p[1]} r="6" />;
}

export function SectionPaths({
  route,
  className,
  arrows,
}: {
  route: Route;
  className: (i: number) => string;
  arrows?: boolean;
}) {
  return (
    <g>
      {route.sectionStart.map((s0, i) => (
        <Line key={i} pts={slice(route, s0, sectionEnd(route, i))} className={className(i)} arrow={arrows} />
      ))}
    </g>
  );
}

export function SectionLabels({ route, only }: { route: Route; only?: (i: number) => boolean }) {
  return (
    <g className="section-labels">
      {route.sectionStart.map((s0, i) => {
        if (only && !only(i)) return null;
        const [x, y] = pointAt(route, (s0 + sectionEnd(route, i)) / 2);
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <circle r="6.5" />
            <text dy="0.35em">{i + 1}</text>
          </g>
        );
      })}
    </g>
  );
}

export function NodeDots({
  nodes,
  className,
}: {
  nodes: TapNode[];
  className?: (n: TapNode) => string | undefined;
}) {
  return (
    <g className="tap-nodes">
      {nodes.map((n) => (
        <circle key={n.id} cx={n.p[0]} cy={n.p[1]} r="4.5" className={className?.(n)} />
      ))}
    </g>
  );
}
