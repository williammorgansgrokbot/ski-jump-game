# Painted cartoon tree sprites: key the GenerateImage sheet (flat hot-pink background), slice the 8 trees, pack one WebP atlas
# art/trees.webp + art/trees.json (rects in px, aspect, relative height). Replaces the old procedural low-poly pine.glb.
#   python3 tools/trees.py
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw
import scipy.ndimage as nd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = ROOT + '/art_src/trees_a.jpg'
NAMES = ['pine_tall', 'fir_fluffy', 'pine_trio', 'fir_snowy', 'spruce_teal', 'fir_amber', 'pine_young', 'fir_violet']
TALL_PX = 400          # tallest sprite height in the atlas
PAD = 6

def key_pink(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    b = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]); bg = np.median(b, 0)
    d = np.sqrt(((a - bg) ** 2).sum(-1))
    al = np.clip((d - 38) / 52, 0, 1)
    al = nd.gaussian_filter(al, 0.5)
    # remove stray bg-coloured islands inside nothing: keep as is (trees are solid)
    rgb = np.where(al[..., None] > 0.02, (a - (1 - al[..., None]) * bg) / np.maximum(al[..., None], 0.05), a)
    rgb = np.clip(rgb, 0, 255)
    # outline pixels mixed with the pink screen come out maroon: pull red back on dark edge pixels
    edge = nd.binary_dilation(al < 0.98, iterations=2) & (al > 0.02) | ((al > 0.02) & (rgb.max(-1) < 125) & (rgb[..., 0] > rgb[..., 1] * 1.25 + 8))
    dark = rgb.max(-1) < 135
    m = edge & dark; cap = np.maximum(rgb[..., 1], rgb[..., 2]) * 1.05 + 4
    rgb[..., 0] = np.where(m, np.minimum(rgb[..., 0], cap), rgb[..., 0])
    return np.dstack([rgb, al * 255]).astype(np.uint8), bg

def slice_trees(img):
    al = img[..., 3] > 100
    lab, k = nd.label(nd.binary_dilation(al, iterations=12))
    sizes = nd.sum(al, lab, range(1, k + 1)); keep = [i + 1 for i, s in enumerate(sizes) if s > 4000]
    cm = {i: nd.center_of_mass(al, lab, i) for i in keep}; H = img.shape[0]
    rows = [[i for i in keep if cm[i][0] < H * 0.5], [i for i in keep if cm[i][0] >= H * 0.5]]
    out = []
    for r in rows:
        assert len(r) == 4, [len(x) for x in rows]
        for i in sorted(r, key=lambda i: cm[i][1]):
            m = (lab == i) & nd.binary_dilation(al, iterations=4); f = img.copy(); f[..., 3] = np.where(m, img[..., 3], 0)
            ys, xs = np.where(f[..., 3] > 6); out.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    return out

def bleed(f):
    """fill fully transparent pixels with nearby tree colour so mip-mapping / filtering never shows a pink halo"""
    rgb = f[..., :3].astype(np.float32); a = f[..., 3] > 20
    idx = nd.distance_transform_edt(~a, return_distances=False, return_indices=True)
    return np.dstack([rgb[idx[0], idx[1]], f[..., 3]]).astype(np.uint8)

def build():
    img, bg = key_pink(SRC); print('bg', bg)
    trees = slice_trees(img); hmax = max(t.shape[0] for t in trees); s = TALL_PX / hmax
    sp = []
    for t in trees:
        h = max(8, round(t.shape[0] * s)); w = max(8, round(t.shape[1] * s))
        sp.append(np.asarray(Image.fromarray(t).resize((w, h), Image.LANCZOS)))
    W = 1024; x = y = PAD; rowh = 0; rects = []
    for f in sp:
        h, w = f.shape[:2]
        if x + w + PAD > W: x = PAD; y += rowh + PAD; rowh = 0
        rects.append([x, y, w, h]); x += w + PAD; rowh = max(rowh, h)
    H = y + rowh + PAD; H = (H + 3) // 4 * 4
    atlas = np.zeros((H, W, 4), np.uint8)
    for f, r in zip(sp, rects):
        g = bleed(np.pad(f, ((3, 3), (3, 3), (0, 0)))); rr = g[3:-3, 3:-3]
        atlas[r[1]:r[1] + r[3], r[0]:r[0] + r[2]] = rr
    # bleed the whole atlas gutter colours too
    atlas = bleed(atlas)
    im = Image.fromarray(atlas, 'RGBA'); im.save(ROOT + '/art/trees.webp', 'WEBP', quality=84, alpha_quality=90, method=6)
    meta = dict(w=W, h=H, r={n: r for n, r in zip(NAMES, rects)}, rel={n: round(r[3] / TALL_PX, 4) for n, r in zip(NAMES, rects)}, aspect={n: round(r[2] / r[3], 4) for n, r in zip(NAMES, rects)})
    json.dump(meta, open(ROOT + '/art/trees.json', 'w'), separators=(',', ':'))
    print('atlas', W, H, os.path.getsize(ROOT + '/art/trees.webp'), 'bytes'); print(meta['rel'])
    # contact sheet
    cw = 330; sheet = Image.new('RGB', (cw * 4, 460 * 2 + 40), (118, 168, 214)); d = ImageDraw.Draw(sheet)
    for i, (n, r) in enumerate(zip(NAMES, rects)):
        c = im.crop((r[0], r[1], r[0] + r[2], r[1] + r[3])); sc = min(1.0, 420 / c.size[1], (cw - 20) / c.size[0]); c = c.resize((max(1, int(c.size[0] * sc)), max(1, int(c.size[1] * sc))))
        ox = (i % 4) * cw + (cw - c.size[0]) // 2; oy = (i // 4) * 460 + 440 - c.size[1] + 20; sheet.paste(c, (ox, oy), c); d.text(((i % 4) * cw + 8, (i // 4) * 460 + 4), n, fill=(255, 255, 255))
    os.makedirs(ROOT + '/previews/sprites', exist_ok=True); sheet.save(ROOT + '/previews/sprites/trees.png')
if __name__ == '__main__': build()
