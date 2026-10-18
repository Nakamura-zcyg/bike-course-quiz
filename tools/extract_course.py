"""コース図 PDF から背景画像（赤線なし）と正解ルートを取り出す。

使い方（リポジトリルートで）:
    python tools/extract_course.py <course.pdf> [--prefix kogata]

PDF の赤線は「幅 2pt の線を輪郭化した塗り」＋「矢じり」の組が区間ごとに並んでいる。
矢じりの先端側を終点として区間を向き付けし、終点と次区間の始点が近いものを順につなぐ。
発着所の T 字（赤の stroke）が始点・終点。
"""
import argparse
import json
import math
import re
from pathlib import Path

import fitz

RED = (1.0, 0.0, 0.0)
CROP = fitz.Rect(135, 85, 775, 562)  # コース図部分（pt）。タイトル・余白を除く
RENDER_SCALE = 2.5
ARROW_MAX_SIZE = 12
CAP_LEN = (1.9, 2.1)
JOIN_MAX_GAP = 8

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
    courses = []
    for pno, page in enumerate(doc):
        drawings = page.get_drawings()
        start_mark = next(d for d in drawings if is_red(d.get("color")))
        sm = start_mark["rect"]
        start_pt = ((sm.x0 + sm.x1) / 2, (sm.y0 + sm.y1) / 2)
        pieces = [piece_centerline(d) for d in drawings if is_red(d.get("fill"))]
        route = chain(pieces, start_pt)

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
            }
        )
        print(cid, "sections", len(route), "points", sum(len(s) for s in route), "image", w_px, h_px)

    out_json = ROOT / "src" / "data" / f"{args.prefix}.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps({"courses": courses}, ensure_ascii=False), encoding="utf-8")
    print("wrote", out_json)


if __name__ == "__main__":
    main()
