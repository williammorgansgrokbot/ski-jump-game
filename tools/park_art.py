# Ski Park painted scenery: key the GenerateImage sheets (features + gates), crop, scale, pack into one WebP atlas + JSON
# with the top-edge silhouette profile of every ramp/rail/box (the game rides on that painted outline).
import sys, os, json
import numpy as np
from PIL import Image
import scipy.ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from key import key
import sprites as S
ROOT = S.ROOT; SRC = ROOT + '/art_src/park/'; OUT = ROOT + '/art/park/'
os.makedirs(OUT, exist_ok=True)

def components(img, n, grid):
    """slice keyed RGBA image into n objects ordered row-major per `grid` = [items in row0, items in row1]"""
    a = np.asarray(img).copy(); al = a[..., 3] > 100
    lab, k = nd.label(nd.binary_dilation(al, iterations=10))
    sizes = nd.sum(al, lab, range(1, k + 1)); keep = [i + 1 for i, s in enumerate(sizes) if s > 3000]
    cm = {i: nd.center_of_mass(al, lab, i) for i in keep}
    H = a.shape[0]; rows = [[], []]
    for i in keep: rows[0 if cm[i][0] < H * 0.5 else 1].append(i)
    objs = []
    for r, cnt in enumerate(grid):
        ids = sorted(rows[r], key=lambda i: cm[i][1]); assert len(ids) == cnt, (r, len(ids), cnt)
        for i in ids:
            m = (lab == i) & nd.binary_dilation(al, iterations=3); f = a.copy(); f[..., 3] = np.where(m, a[..., 3], 0)
            ys, xs = np.where(f[..., 3] > 8); objs.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    return objs

def kill_green(f):
    f = f.copy(); r, g, b = [f[..., i].astype(int) for i in range(3)]; m = (g - np.maximum(r, b)) > 45; f[..., 3] = np.where(m, 0, f[..., 3]); return f

def resize_w(f, w):
    h = max(1, round(f.shape[0] * w / f.shape[1])); return np.asarray(Image.fromarray(f).resize((w, h), Image.LANCZOS))

def profile(f, n=120):
    """top-edge height (0..1 of sprite height, measured up from the sprite bottom) at n columns across the opaque width"""
    al = f[..., 3] > 128; H, W = al.shape; out = []
    for i in range(n):
        c0 = int(i * W / n); c1 = max(c0 + 1, int((i + 1) * W / n)); col = al[:, c0:c1].any(axis=1)
        ys = np.where(col)[0]; out.append(0.0 if len(ys) == 0 else (H - ys.min()) / H)
    out = np.array(out); k = np.ones(3) / 3; out = np.convolve(np.pad(out, 1, mode='edge'), k, mode='valid'); return [round(float(v), 4) for v in out]

def build():
    feats = components(key(SRC + 'features_a.jpg', hole_min=120), 5, [3, 2])
    scen = components(key(SRC + 'scenery_a.jpg', hole_min=120), 4, [2, 2])
    names = [('kick_s', 640), ('kick_m', 768), ('kick_b', 1152), ('rail', 1024), ('box', 1024), ('finish', 768), ('start', 640), ('snowman', 300), ('trick', 520)]
    objs = feats + scen; items = {}; prof = {}
    for (nm, w), f in zip(names, objs):
        g = resize_w(kill_green(f), w); items[nm] = g
        if nm in ('kick_s', 'kick_m', 'kick_b', 'rail', 'box'): prof[nm] = profile(g)
        print(nm, g.shape[1::-1])
    PAD = 8; its = [(nm, g.shape[1] + 2 * PAD, g.shape[0] + 2 * PAD) for nm, g in items.items()]
    pages = S.shelf_pack(its, 2048, 4096); assert len(pages) == 1
    H = (pages[0]['H'] + 3) // 4 * 4; atlas = np.zeros((H, 2048, 4), np.uint8); r = {}
    for nm, (x, y) in pages[0]['pos'].items():
        g = items[nm]; atlas[y + PAD:y + PAD + g.shape[0], x + PAD:x + PAD + g.shape[1]] = g; r[nm] = [x + PAD, y + PAD, g.shape[1], g.shape[0]]
    S.bleed(atlas)
    Image.fromarray(atlas).save(OUT + 'park.webp', 'WEBP', quality=86, alpha_quality=100, method=6)
    json.dump({'w': 2048, 'h': H, 'r': r, 'prof': prof}, open(OUT + 'park.json', 'w'), separators=(',', ':'))
    print('atlas', 2048, H, os.path.getsize(OUT + 'park.webp') // 1024, 'KB')
    # check sheet with profile overlay
    from PIL import ImageDraw
    cv = Image.new('RGB', (2048, 900), (118, 168, 214)); d = ImageDraw.Draw(cv); x = 10
    for nm in ('kick_s', 'kick_m', 'kick_b', 'rail', 'box'):
        g = items[nm]; sc = 0.45; gi = Image.fromarray(g).resize((int(g.shape[1] * sc), int(g.shape[0] * sc))); cv.paste(gi, (x, 450 - gi.height), gi)
        p = prof[nm]; pts = [(x + i * gi.width / len(p), 450 - v * gi.height) for i, v in enumerate(p)]; d.line(pts, fill=(255, 0, 255), width=2); x += gi.width + 20
    cv.save(ROOT + '/previews/park_profiles.png')
build()
