"""コース図 PDF から背景画像（赤線なし）と正解ルートを取り出す。

使い方（リポジトリルートで）:
    python tools/extract_course.py <course.pdf> [--prefix kogata]

PDF の赤線は「幅 2pt の線を輪郭化した塗り」＋「矢じり」の組が区間ごとに並んでいる。
矢じりの先端側を終点として区間を向き付けし、終点と次区間の始点が近いものを順につなぐ。
発着所の T 字（赤の stroke）が始点・終点。

タップモードの候補点もここで作る。番号ポール（交差点の中心）を基本に、ポールから離れた曲がり角を足す。
「同じ交差点」かどうかは、間に島の縁や縁石の線（PDF に埋め込まれた地図画像の暗い画素）を挟まないかで判断する。
内側の道と外周の道は縁石で隔てられているので、別の候補点になる。
"""
import argparse
import io
import json
import math
import re
import unicodedata
from pathlib import Path

import fitz
import numpy as np
from PIL import Image

RED = (1.0, 0.0, 0.0)
CROP = fitz.Rect(135, 85, 775, 562)  # コース図部分（pt）。タイトル・余白を除く
RENDER_SCALE = 2.5
ARROW_MAX_SIZE = 12
CAP_LEN = (1.9, 2.1)
POLE_FONT_SIZE = 11.0  # 番号ポール（交差点）の数字。課題番号（①など）は 8pt
JOIN_MAX_GAP = 8

WALL_DARK = 170  # 地図画像でこれより暗い画素を島の縁・縁石とみなす（0-255）
WALL_STEP = 0.25  # 壁判定で線分をたどる間隔（pt）
CORNER_EPS = 2.5
CORNER_MIN_TURN_DEG = 25
POLE_ABSORB = 36  # ポールからこの距離以内で壁を挟まない曲がり角はポールの交差点に含める
NODE_MERGE = 24  # ポールのない曲がり角同士をまとめる距離
POLE_MATCH = 30  # ルートがこの距離以内を（壁を挟まず）通ったら、その候補点を通過したとみなす
NODE_MATCH = 22
POLE_CLEAR = 5  # ポールは縁石の先端に立っていることがあるので、ポール中心のまわりの壁は無視する

ROOT = Path(__file__).resolve().parent.parent


def is_red(c):
    return c is not None and tuple(round(x, 2) for x in c) == RED


def subpaths(items):
    subs, cur, prev = [], [], None
    for it in items:
        if it[0] == "re":
            r = it[1]
            if cur:
                subs.append(cur)
            subs.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)])
            cur, prev = [], None
            continue
        pts = [(q.x, q.y) for q in it[1:] if isinstance(q, fitz.Point)]
        if prev is None or math.dist(pts[0], prev) > 0.01:
            if cur:
                subs.append(cur)
            cur = [pts[0]]
        cur.append(pts[-1])
        prev = pts[-1]
    if cur:
        subs.append(cur)
    return subs


def size(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return max(max(xs) - min(xs), max(ys) - min(ys))


def piece_centerline(drawing):
    """輪郭の片側（キャップからキャップまで）を中心線の近似として使う（誤差 1pt）。"""
    subs = subpaths(drawing["items"])
    lines = [s for s in subs if size(s) >= ARROW_MAX_SIZE]
    arrows = [s for s in subs if size(s) < ARROW_MAX_SIZE]
    assert len(lines) == 1 and len(arrows) == 1, (len(lines), len(arrows))
    outline = lines[0]
    n = len(outline)
    caps = [i for i in range(n) if CAP_LEN[0] < math.dist(outline[i], outline[(i + 1) % n]) < CAP_LEN[1]]
    a, b = caps[0], caps[1]
    side = outline[a + 1 : b + 1]
    tip = arrows[0][1]
    if math.dist(side[0], tip) < math.dist(side[-1], tip):
        side = side[::-1]
    side[-1] = tip
    return side


def chain(pieces, start_pt):
    start = min(range(len(pieces)), key=lambda i: math.dist(pieces[i][0], start_pt))
    order, used, cur = [start], {start}, start
    while len(order) < len(pieces):
        end = pieces[cur][-1]
        nxt = min((i for i in range(len(pieces)) if i not in used), key=lambda i: math.dist(end, pieces[i][0]))
        gap = math.dist(end, pieces[nxt][0])
        assert gap < JOIN_MAX_GAP, f"区間 {cur} の終点の近くに次の区間がない (gap={gap:.1f})"
        order.append(nxt)
        used.add(nxt)
        cur = nxt
    return [pieces[i] for i in order]


def poles(page):
    """番号ポールの位置 = 交差点の中心。ルートの線はポールの円を通るように描かれている"""
    out = []
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for s in line["spans"]:
                t = unicodedata.normalize("NFKC", s["text"]).strip()
                if t.isdigit() and abs(s["size"] - POLE_FONT_SIZE) < 0.2:
                    x0, y0, x1, y1 = s["bbox"]
                    c = ((x0 + x1) / 2, (y0 + y1) / 2)
                    if CROP.contains(fitz.Point(*c)):
                        out.append({"n": int(t), "p": rnd(c)})
    return sorted(out, key=lambda q: q["n"])


class Walls:
    def __init__(self, page):
        info = page.get_image_info(xrefs=True)[0]
        bbox = fitz.Rect(info["bbox"])
        data = page.parent.extract_image(info["xref"])["image"]
        self.dark = np.asarray(Image.open(io.BytesIO(data)).convert("L")) < WALL_DARK
        self.h, self.w = self.dark.shape
        self.sx = self.w / bbox.width
        self.sy = self.h / bbox.height
        self.ox = bbox.x0 - CROP.x0
        self.oy = bbox.y0 - CROP.y0

    def blocked(self, a, b, clear_b=0.0):
        """切り抜き座標の 2 点の間に壁があるか（b から clear_b 以内は見ない）"""
        n = max(1, int(math.dist(a, b) / WALL_STEP))
        for k in range(n + 1):
            x = a[0] + (b[0] - a[0]) * k / n
            y = a[1] + (b[1] - a[1]) * k / n
            if math.dist((x, y), b) < clear_b:
                continue
            px = int((x - self.ox) * self.sx)
            py = int((y - self.oy) * self.sy)
            if 0 <= px < self.w and 0 <= py < self.h and self.dark[py, px]:
                return True
        return False


def rdp(pts, eps):
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    L = math.dist(a, b) or 1e-9
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs((b[1] - a[1]) * x0 - (b[0] - a[0]) * y0 + b[0] * a[1] - b[1] * a[0]) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax <= eps:
        return [a, b]
    return rdp(pts[: idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def turn_deg(a, b, c):
    d = abs(math.degrees(math.atan2(c[1] - b[1], c[0] - b[0]) - math.atan2(b[1] - a[1], b[0] - a[0]))) % 360
    return min(d, 360 - d)


def flatten(sections):
    """TS の buildRoute と同じ連結（同じ点の連続は 1 つにする）"""
    pts = []
    for sec in sections:
        for p in sec:
            if not pts or math.dist(pts[-1], p) >= 1e-6:
                pts.append(tuple(p))
    return pts


def build_nodes(routes, pole_pts, walls):
    nodes = [{"p": p, "pole": n} for n, p in pole_pts]
    leftover = []
    for pts in routes:
        simp = rdp(pts, CORNER_EPS)
        corners = [simp[i] for i in range(1, len(simp) - 1) if turn_deg(simp[i - 1], simp[i], simp[i + 1]) >= CORNER_MIN_TURN_DEG]
        for c in corners + [pts[-1]]:
            if not any(math.dist(c, nd["p"]) <= POLE_ABSORB and not walls.blocked(c, nd["p"], POLE_CLEAR) for nd in nodes):
                leftover.append(c)
    clusters = [[c] for c in leftover]
    centroid = lambda cl: (sum(p[0] for p in cl) / len(cl), sum(p[1] for p in cl) / len(cl))
    while True:
        best = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                a, b = centroid(clusters[i]), centroid(clusters[j])
                d = math.dist(a, b)
                if d <= NODE_MERGE and (best is None or d < best[0]) and not walls.blocked(a, b):
                    best = (d, i, j)
        if not best:
            break
        _, i, j = best
        clusters[i] += clusters.pop(j)
    nodes += [{"p": centroid(cl), "pole": None} for cl in clusters]
    return nodes


def expected_taps(pts, nodes, walls):
    """ルートを 1pt ずつたどり、最寄りの候補点（壁を挟まない半径内）が切り替わるたびに 1 手とする"""
    S = [0.0]
    for i in range(1, len(pts)):
        S.append(S[-1] + math.dist(pts[i - 1], pts[i]))

    def point_at(s):
        i = 1
        while i < len(pts) - 1 and S[i] < s:
            i += 1
        t = max(0.0, min(1.0, (s - S[i - 1]) / ((S[i] - S[i - 1]) or 1)))
        return (pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t)

    steps, cur = [], None

    def flush():
        nonlocal cur
        if cur and (not steps or steps[-1]["node"] != cur[0]):
            steps.append({"node": cur[0], "s": round(cur[1], 1)})
        cur = None

    s = 0.0
    while s <= S[-1]:
        p = point_at(s)
        best = None
        for idx, nd in enumerate(nodes):
            d = math.dist(p, nd["p"])
            r = POLE_MATCH if nd["pole"] else NODE_MATCH
            clear = POLE_CLEAR if nd["pole"] else 0.0
            if d <= r and (best is None or d < best[1]) and not walls.blocked(p, nd["p"], clear):
                best = (idx, d)
        if best is None:
            flush()
        else:
            if cur and cur[0] != best[0]:
                flush()
            if cur is None or best[1] < cur[2]:
                cur = (best[0], s, best[1])
        s += 1.0
    flush()
    # スタート地点は最初から示しているので、出発直後にスタート地点の候補を通るぶんは数えない
    while steps and steps[0]["s"] <= POLE_MATCH * 2 and math.dist(nodes[steps[0]["node"]]["p"], pts[0]) <= POLE_MATCH:
        steps.pop(0)
    return steps


def render_original(page, out_png):
    page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), clip=CROP, alpha=False).save(out_png)


def render_background(page, out_png):
    page.clean_contents()
    xref = page.get_contents()[0]
    s = page.parent.xref_stream(xref).decode("latin-1")
    # 赤の塗り / 線のブロックだけ描画しない（パスを n で捨てる）
    s = re.sub(r"(1 0 0 rg[^Q]*?) f\*? Q", r"\1 n Q", s)
    s = re.sub(r"(1 0 0 RG[^Q]*?) S Q", r"\1 n Q", s)
    page.parent.update_stream(xref, s.encode("latin-1"))
    for d in page.get_drawings():
        assert not is_red(d.get("fill")) and not is_red(d.get("color")), "赤線が残っている"
    pix = page.get_pixmap(matrix=fitz.Matrix(RENDER_SCALE, RENDER_SCALE), clip=CROP, alpha=False)
    pix.save(out_png)
    return pix.width, pix.height


def rnd(p):
    return [round(p[0] - CROP.x0, 1), round(p[1] - CROP.y0, 1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--prefix", default="kogata")
    ap.add_argument("--class-name", default="小型二輪")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    walls = Walls(doc[0])
    courses = []
    for pno, page in enumerate(doc):
        drawings = page.get_drawings()
        start_mark = next(d for d in drawings if is_red(d.get("color")))
        sm = start_mark["rect"]
        start_pt = ((sm.x0 + sm.x1) / 2, (sm.y0 + sm.y1) / 2)
        pieces = [piece_centerline(d) for d in drawings if is_red(d.get("fill"))]
        route = chain(pieces, start_pt)
        pole_list = poles(page)

        cid = f"{args.prefix}-{pno + 1}"
        out_png = ROOT / "public" / "courses" / f"{cid}.png"
        out_png.parent.mkdir(parents=True, exist_ok=True)
        render_original(page, str(out_png.with_name(f"{cid}-original.png")))
        w_px, h_px = render_background(page, str(out_png))
        courses.append(
            {
                "id": cid,
                "name": f"{args.class_name} {pno + 1}号コース",
                "image": f"courses/{cid}.png",
                "originalImage": f"courses/{cid}-original.png",
                "width": round(CROP.width, 1),
                "height": round(CROP.height, 1),
                "sections": [[rnd(p) for p in sec] for sec in route],
                "poles": pole_list,
            }
        )
        print(cid, "poles", len(pole_list), "sections", len(route), "points", sum(len(s) for s in route), "image", w_px, h_px)

    # 地図は全ページ共通。ポール番号の文字位置がページでわずかに違うので平均する
    by_n = {}
    for c in courses:
        for q in c.pop("poles"):
            by_n.setdefault(q["n"], []).append(q["p"])
    pole_pts = [(n, (sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps))) for n, ps in sorted(by_n.items())]
    routes = [flatten(c["sections"]) for c in courses]
    nodes = build_nodes(routes, pole_pts, walls)
    for c, pts in zip(courses, routes):
        c["taps"] = expected_taps(pts, nodes, walls)
        print(c["id"], "taps", len(c["taps"]))
    tap_nodes = [{"id": i, "p": [round(nd["p"][0], 1), round(nd["p"][1], 1)], "pole": nd["pole"]} for i, nd in enumerate(nodes)]
    print("tap nodes", len(tap_nodes), "poles", sum(1 for n in tap_nodes if n["pole"]))

    out_json = ROOT / "src" / "data" / f"{args.prefix}.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"tapNodes": tap_nodes, "courses": courses}, ensure_ascii=False), encoding="utf-8")
    print("wrote", out_json)


if __name__ == "__main__":
    main()
