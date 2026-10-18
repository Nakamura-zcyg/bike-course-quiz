import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../constants";
import type { Pt } from "../lib/geometry";

export type Interaction = "draw" | "pan" | "none";

interface Props {
  width: number;
  height: number;
  image: string;
  interaction: Interaction;
  /** mapPerPx: 画面 1px がコース図の何 pt か（タップの当たり判定用） */
  onDown?: (p: Pt, mapPerPx: number) => void;
  onMove?: (p: Pt) => void;
  onUp?: () => void;
  children?: ReactNode;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

const IDENTITY: View = { k: 1, tx: 0, ty: 0 };

export function CourseMap({ width, height, image, interaction, onDown, onMove, onUp, children }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ view: View; mid: Pt; d: number } | null>(null);
  const drawingId = useRef<number | null>(null);

  const clamp = useCallback(
    (v: View): View => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k));
      return {
        k,
        tx: Math.min(0, Math.max(width - width * k, v.tx)),
        ty: Math.min(0, Math.max(height - height * k, v.ty)),
      };
    },
    [width, height],
  );

  /** 画面座標 → svg の viewBox 座標（拡大前） */
  const toRoot = (x: number, y: number): Pt => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return [x, y];
    const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  /** 画面座標 → コース図座標（拡大後） */
  const toMap = (x: number, y: number): Pt => {
    const ctm = layerRef.current?.getScreenCTM();
    if (!ctm) return [x, y];
    const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  const zoomAt = useCallback(
    (factor: number, center: Pt) =>
      setView((v) => {
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
        const mx = (center[0] - v.tx) / v.k;
        const my = (center[1] - v.ty) / v.k;
        return clamp({ k, tx: center[0] - mx * k, ty: center[1] - my * k });
      }),
    [clamp],
  );

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const mid: Pt = pts.length >= 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : pts[0];
    const d = pts.length >= 2 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0;
    gesture.current = { view: viewRef.current, mid, d };
  };

  const handleDown = (e: React.PointerEvent) => {
    if (interaction === "none") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (interaction === "pan") {
      pointers.current.set(e.pointerId, toRoot(e.clientX, e.clientY));
      startGesture();
      return;
    }
    if (drawingId.current !== null) return; // 描画中の 2 本目の指は無視
    drawingId.current = e.pointerId;
    const ctm = layerRef.current?.getScreenCTM();
    onDown?.(toMap(e.clientX, e.clientY), ctm ? 1 / ctm.a : 1);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (interaction === "pan") {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, toRoot(e.clientX, e.clientY));
      const g = gesture.current;
      if (!g) return;
      const pts = [...pointers.current.values()];
      if (pts.length >= 2 && g.d > 0) {
        const mid: Pt = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
        const d = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
        const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (g.view.k * d) / g.d));
        const mx = (g.mid[0] - g.view.tx) / g.view.k;
        const my = (g.mid[1] - g.view.ty) / g.view.k;
        setView(clamp({ k, tx: mid[0] - mx * k, ty: mid[1] - my * k }));
      } else {
        setView(clamp({ k: g.view.k, tx: g.view.tx + pts[0][0] - g.mid[0], ty: g.view.ty + pts[0][1] - g.mid[1] }));
      }
      return;
    }
    if (drawingId.current !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    if (events.length) for (const ev of events) onMove?.(toMap(ev.clientX, ev.clientY));
    else onMove?.(toMap(e.clientX, e.clientY));
  };

  const handleUp = (e: React.PointerEvent) => {
    if (pointers.current.delete(e.pointerId)) {
      startGesture();
      return;
    }
    if (drawingId.current === e.pointerId) {
      drawingId.current = null;
      onUp?.();
    }
  };

  // PC のホイール拡大。React の onWheel は passive なので preventDefault できず、直接登録する
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, [p.x, p.y]);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    pointers.current.clear();
    gesture.current = null;
  }, [interaction]);

  const center: Pt = [width / 2, height / 2];

  return (
    <div className={`course-map ${interaction === "pan" ? "is-pan" : ""}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      >
        <g ref={layerRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <image href={image} width={width} height={height} />
          {children}
        </g>
      </svg>
      {interaction === "pan" && (
        <div className="zoom-controls">
          <button type="button" aria-label="拡大" onClick={() => zoomAt(ZOOM_STEP, center)}>
            <Plus />
          </button>
          <button type="button" aria-label="縮小" onClick={() => zoomAt(1 / ZOOM_STEP, center)}>
            <Minus />
          </button>
          <button type="button" aria-label="全体表示" onClick={() => setView(IDENTITY)}>
            <Maximize />
          </button>
        </div>
      )}
    </div>
  );
}
