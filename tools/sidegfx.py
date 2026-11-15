# Slice the generated side-graphics sheets (banners, flags, signs, light posts) + arches into one WebP atlas + JSON uv map.
import sys, os, json, math
import numpy as np
from PIL import Image
import scipy.ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from key import key
from sprites import shelf_pack, bleed
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = ROOT + '/art_src/side/'; OUT = ROOT + '/art/side/'
os.makedirs(OUT, exist_ok=True)
SHEETS = [('banner', 'banners.jpg', 2, 4, 512), ('flag', 'flags.jpg', 3, 3, 384), ('sign', 'signs.jpg', 3, 2, 256), ('post', 'posts.jpg', 6, 1, 0)]
POST_H = 640
PAD = 8

def slice_sheet(fn, cols, rows):
    a = np.asarray(key(SRC + fn, hole_min=0, t0=30, t1=80, dom0=150)).copy(); H, W = a.shape[:2]; out = []
    for k in range(rows * cols):
        r, c = divmod(k, cols); y0, y1, x0, x1 = int(r * H / rows), int((r + 1) * H / rows), int(c * W / cols), int((c + 1) * W / cols)
        f = a[y0:y1, x0:x1].copy(); al = f[..., 3] > 60
        lab, n = nd.label(al); sizes = nd.sum(al, lab, range(1, n + 1)); keep = [i for i in range(1, n + 1) if sizes[i - 1] > 150]
        m = np.isin(lab, keep); f[..., 3] = np.where(m, f[..., 3], 0)
        ys, xs = np.where(f[..., 3] > 8); out.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    return out

def resize(f, w=None, h=None):
    im = Image.fromarray(f); s = (w / im.width) if w else (h / im.height)
    pm = np.asarray(im).astype(np.float32); al = pm[..., 3:4] / 255; pm2 = np.concatenate([pm[..., :3] * al, pm[..., 3:]], -1)
    import cv2
    r = cv2.resize(pm2, (max(1, round(im.width * s)), max(1, round(im.height * s))), interpolation=cv2.INTER_AREA)
    a2 = np.clip(r[..., 3:4] / 255, 0, 1); rgb = np.where(a2 > 1e-3, r[..., :3] / np.maximum(a2, 1e-3), 0)
    return np.concatenate([rgb, a2 * 255], -1).clip(0, 255).astype(np.uint8)

items = []   # (name, array)
for kind, fn, cols, rows, w in SHEETS:
    for i, f in enumerate(slice_sheet(fn, cols, rows)):
        items.append(('%s%d' % (kind, i), resize(f, w=w) if w else resize(f, h=POST_H)))
pk = shelf_pack([(n, a.shape[1] + 2 * PAD, a.shape[0] + 2 * PAD) for n, a in items], W=2048, Hmax=2048)
assert len(pk) == 1
H = max(p['H'] for p in pk); Hp = 1
while Hp < H: Hp *= 2
atl = np.zeros((Hp, 2048, 4), np.uint8); meta = {'w': 2048, 'h': Hp, 'r': {}}
amap = dict(items)
for n, (x, y) in pk[0]['pos'].items():
    a = amap[n]; atl[y + PAD:y + PAD + a.shape[0], x + PAD:x + PAD + a.shape[1]] = a
    meta['r'][n] = [x + PAD, y + PAD, a.shape[1], a.shape[0]]
bleed(atl)
Image.fromarray(atl).save(OUT + 'side.webp', 'WEBP', quality=90, alpha_quality=100, method=6)
Image.fromarray(atl).save('/tmp/side_atlas_preview.png')
for nm, fn in (('arch_a', 'arch_a.jpg'), ('arch_b', 'arch_b.jpg')):
    f = np.asarray(key(SRC + fn, hole_min=0)); ys, xs = np.where(f[..., 3] > 8); f = f[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    f = resize(f, w=1024); im = f.copy(); bleed(im); Image.fromarray(im).save(OUT + nm + '.webp', 'WEBP', quality=90, alpha_quality=100, method=6)
    meta['r'][nm] = [0, 0, f.shape[1], f.shape[0]]
json.dump(meta, open(OUT + 'side.json', 'w'), separators=(',', ':'))
print(meta['h'], {k: v[2:] for k, v in meta['r'].items()})
for fn in os.listdir(OUT): print(fn, os.path.getsize(OUT + fn))
