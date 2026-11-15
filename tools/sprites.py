# Sprite pipeline: key generated sheets -> slice -> flip/scale -> anchor -> recolor suits -> pack PNG atlases + JSON.
# All character art comes from GenerateImage sheets in art_src/sprites; this script only keys / slices / recolors / packs.
import sys, os, json, math
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
import scipy.ndimage as nd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from key import key

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = ROOT + '/art_src/sprites/'
OUT = ROOT + '/art/sprites/'
PRE = ROOT + '/previews/sprites/'
os.makedirs(OUT, exist_ok=True); os.makedirs(PRE, exist_ok=True)

# name, file, rows, cols, flip (True = all frames, list = per frame), fps, loop, per-frame order
SHEETS = [
 dict(name='idle',      file='idlewave_a.jpg',  rows=2, cols=3, flip=False,                     fps=8,  loop=True),
 dict(name='crouch',    file='crouch_a.jpg',    rows=2, cols=2, flip=False,                     fps=8,  loop=True),
 dict(name='takeoff',   file='takeoff_a.jpg',   rows=2, cols=3, flip=True,                      fps=14, loop=False),
 dict(name='flight',    file='flight_a.jpg',    rows=2, cols=3, flip=True,                      fps=12, loop=True),
 dict(name='preland',   file='preland_a.jpg',   rows=2, cols=2, flip=True,                      fps=10, loop=False),
 dict(name='telemark',  file='telemark_b.jpg',  rows=2, cols=3, flip=True,                      fps=10, loop=False),
 dict(name='sloppy',    file='sloppy_a.jpg',    rows=2, cols=3, flip=[False,True,True,True,True,True], fps=10, loop=False),
 dict(name='skid',      file='skid_a.jpg',      rows=2, cols=3, flip=True,                      fps=10, loop=False, anchor='tip'),
 dict(name='cheerFist', file='fistpump_a.jpg',  rows=2, cols=3, flip=True,                      fps=10, loop=True),
 dict(name='cheerShow', file='showboat_a.jpg',  rows=2, cols=3, flip=True,                      fps=9,  loop=True),
]
SKI_LEN = float(os.environ.get('SKI_LEN', 232))   # target ski length in atlas px
PAD = 3

def hsv_of(rgb):  # rgb float 0..1 -> H(deg),S,V
    h = cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2HSV)
    return h[..., 0], h[..., 1], h[..., 2]

def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def masks(rgba):
    """return dict of float masks on a frame (RGBA uint8): suit(red), ski(violet), bib(yellow)"""
    a = rgba.astype(np.float32); rgb = a[..., :3] / 255; al = a[..., 3] / 255
    H, S, V = hsv_of(rgb); Hs = ((H + 60) % 360) - 60
    suit = (1 - smooth(Hs, 7, 13)) * smooth(Hs, -45, -35) * smooth(S, 0.22, 0.42) * smooth(V, 0.10, 0.22)
    suit = np.where(Hs < -35, 0, suit)
    # wrap: hue 320..360 counts as red too
    suit = np.maximum(suit, smooth(H, 318, 335) * smooth(S, 0.22, 0.42) * smooth(V, 0.10, 0.22) * (H >= 318))
    ski = smooth(H, 228, 242) * (1 - smooth(H, 292, 306)) * smooth(S, 0.22, 0.4) * smooth(V, 0.12, 0.25)
    bib = smooth(H, 38, 46) * (1 - smooth(H, 66, 76)) * smooth(S, 0.45, 0.6) * smooth(V, 0.55, 0.7)
    return dict(suit=suit * al, ski=ski * al, bib=bib * al)

def load_sheet(sp):
    im = key(SRC + sp['file'], hole_min=0)
    a = np.asarray(im).copy()
    H, W = a.shape[:2]; rows, cols = sp['rows'], sp['cols']
    al = a[..., 3] > 60
    lab, n = nd.label(nd.binary_dilation(al, iterations=3))
    cy = nd.center_of_mass(np.ones_like(lab), lab, range(1, n + 1))
    cell = {}
    sizes = nd.sum(al, lab, range(1, n + 1))
    for i in range(1, n + 1):
        if sizes[i - 1] < 40: continue
        y, x = cy[i - 1]
        r = min(rows - 1, int(y / H * rows)); c = min(cols - 1, int(x / W * cols))
        cell.setdefault(r * cols + c, []).append(i)
    frames = []
    for k in range(rows * cols):
        m = np.isin(lab, cell.get(k, [])) & nd.binary_dilation(al, iterations=3)
        f = a.copy(); f[..., 3] = np.where(m, a[..., 3], 0)
        ys, xs = np.where(f[..., 3] > 8)
        if len(ys) == 0: raise SystemExit('empty cell %s %d' % (sp['name'], k))
        # warn if touching cell border
        cw, ch = W / cols, H / rows; r, c = divmod(k, cols)
        if xs.min() < c * cw + 2 or xs.max() > (c + 1) * cw - 2 or ys.min() < r * ch + 2 or ys.max() > (r + 1) * ch - 2:
            print('  note: %s frame %d touches its cell border' % (sp['name'], k))
        frames.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy())
    return frames

def ski_length(frame):
    m = masks(frame)['ski'] > 0.5
    lab, n = nd.label(m)
    best = 0
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) < 200: continue
        pts = np.stack([xs, ys], 1).astype(np.float32); pts -= pts.mean(0)
        u, s, vt = np.linalg.svd(pts, full_matrices=False)
        p = pts @ vt[0]; best = max(best, p.max() - p.min())
    return best

def resize_rgba(f, s):
    if abs(s - 1) < 1e-3: return f
    a = f.astype(np.float32); al = a[..., 3:4] / 255
    pm = np.concatenate([a[..., :3] * al, a[..., 3:4]], -1)
    h, w = f.shape[:2]; nw, nh = max(1, round(w * s)), max(1, round(h * s))
    pm = cv2.resize(pm, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    al2 = np.clip(pm[..., 3:4] / 255, 0, 1)
    rgb = np.where(al2 > 1e-3, pm[..., :3] / np.maximum(al2, 1e-3), 0)
    return np.concatenate([rgb, al2 * 255], -1).clip(0, 255).astype(np.uint8)

def anchor_of(f, s, mode='centroid'):
    m = masks(f)['ski']
    ys, xs = np.where(m > 0.5)
    if len(xs) < 50: return (f.shape[1] / 2, f.shape[0] - 2)
    x = float(xs.mean())
    if mode == 'tip': x = float(xs.max() - SKI_LEN * 0.5)
    return (x, float(ys.mean() + 3.5 * s))

def build_frames():
    anims = []
    for sp in SHEETS:
        fr = load_sheet(sp)
        for i in range(len(fr)):
            fl = sp['flip'] if isinstance(sp['flip'], bool) else sp['flip'][i]
            if fl: fr[i] = np.ascontiguousarray(fr[i][:, ::-1])
        L = sorted([ski_length(f) for f in fr]); med = L[len(L) // 2]
        s = SKI_LEN / med if med > 0 else 1.0
        fr = [resize_rgba(f, s) for f in fr]
        anc = [anchor_of(f, s, sp.get('anchor', 'centroid')) for f in fr]
        print('%-10s frames=%d ski_len=%.0f scale=%.3f' % (sp['name'], len(fr), med, s))
        anims.append(dict(sp=sp, frames=fr, anchors=anc, scale=s))
    return anims

def checker(w, h, c=16):
    y, x = np.mgrid[:h, :w]; m = ((x // c + y // c) % 2).astype(np.float32)
    return (np.where(m[..., None] > 0, 206, 232) * np.ones((h, w, 3))).astype(np.float32)

def comp(f, bg):
    a = f[..., 3:4] / 255.0
    return bg * (1 - a) + f[..., :3] * a

def contact(anim, frames, path, cols=None, bgmode='checker'):
    n = len(frames); cols = cols or min(n, 3)
    rows = math.ceil(n / cols)
    cw = max(f.shape[1] for f in frames) + 24; ch = max(f.shape[0] for f in frames) + 40
    W, H = cw * cols, ch * rows
    sheet = checker(W, H) if bgmode == 'checker' else np.full((H, W, 3), (110, 160, 205), np.float32)
    im = Image.fromarray(sheet.astype(np.uint8)); dr = ImageDraw.Draw(im)
    for i, f in enumerate(frames):
        r, c = divmod(i, cols); ox, oy = c * cw + 12, r * ch + 28
        reg = np.asarray(im).astype(np.float32)[oy:oy + f.shape[0], ox:ox + f.shape[1]]
        tile = comp(f, reg).astype(np.uint8)
        im.paste(Image.fromarray(tile), (ox, oy))
        dr.text((c * cw + 8, r * ch + 6), '%s #%d' % (anim['sp']['name'], i + 1), fill=(20, 20, 20))
        ax, ay = anim['anchors'][i]
        dr.line([(ox + ax - 8, oy + ay), (ox + ax + 8, oy + ay)], fill=(255, 0, 255), width=1)
        dr.line([(ox + ax, oy + ay - 8), (ox + ax, oy + ay + 8)], fill=(255, 0, 255), width=1)
    im.save(path)

if __name__ == '__main__' and (len(sys.argv) < 2 or sys.argv[1] != 'build'):
    anims = build_frames()
    for a in anims:
        contact(a, a['frames'], '/tmp/dbg_%s.png' % a['sp']['name'])
        ax = [round(p[0]) for p in a['anchors']]; ay = [round(p[1]) for p in a['anchors']]
        print('  ', a['sp']['name'], 'ax', ax, 'ay', ay, 'sizes', [f.shape[1::-1] for f in a['frames']])

# ---------------------------------------------------------------- packing
def shelf_pack(items, W=2048, Hmax=2048):
    """items: list of (id,w,h). returns pages: list of dict(id->(x,y)), page heights"""
    order = sorted(items, key=lambda t: -t[2])
    pages = []; cur = dict(pos={}, x=0, y=0, rowh=0, H=0)
    def newpage():
        nonlocal cur
        pages.append(cur); cur = dict(pos={}, x=0, y=0, rowh=0, H=0)
    for id_, w, h in order:
        if cur['x'] + w > W:
            cur['y'] += cur['rowh']; cur['x'] = 0; cur['rowh'] = 0
        if cur['y'] + h > Hmax:
            cur['H'] = cur['y'] + cur['rowh']; newpage()
        cur['pos'][id_] = (cur['x'], cur['y']); cur['x'] += w; cur['rowh'] = max(cur['rowh'], h)
    cur['H'] = cur['y'] + cur['rowh']; pages.append(cur)
    return pages

def pot(n):
    p = 1
    while p < n: p *= 2
    return p

def bleed(im):
    # copy colour of the nearest opaque pixel into fully transparent pixels (no dark fringe under bilinear filtering)
    a = im[..., 3] > 0
    idx = nd.distance_transform_edt(~a, return_distances=False, return_indices=True)
    near = im[idx[0], idx[1], :3]
    im[..., :3] = np.where(a[..., None], im[..., :3], near)

# ---------------------------------------------------------------- recolor
SUITS = [
 dict(id='wyatt',   name='Wyatt',   hue=None, num='7'),
 dict(id='reid',    name='Reid',    hue=218,  num='12'),
 dict(id='brady',   name='Brady',   hue=128,  num='5'),
 dict(id='stetson', name='Stetson', hue=56,   num='21', sat=0.93, vmul=1.04, vadd=0.1),
 dict(id='gold',    name='Gold',    hue=42,   num='1',  sat=0.95, vmul=0.93, vadd=0.06, sheen=True),
 dict(id='galaxy',  name='Galaxy',  hue=262,  num='99', sat=0.9, vmul=0.82, vadd=0.0, galaxy=True),
]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def hsv_to_rgb(H, S, V):
    return cv2.cvtColor(np.dstack([H, S, V]).astype(np.float32), cv2.COLOR_HSV2RGB)

def stamp_bib(rgb, mk, num, rng):
    """paint bib white + number; rgb float 0..1 modified in place. returns True if number drawn"""
    b = mk['bib'] > 0.5
    lab, n = nd.label(b)
    if n == 0: return False
    sizes = nd.sum(b, lab, range(1, n + 1)); i = int(np.argmax(sizes)) + 1
    blob = (lab == i)
    soft = np.clip(nd.gaussian_filter(nd.binary_dilation(blob, iterations=1).astype(np.float32), 0.7), 0, 1) * (mk['bib'] > 0.12)
    # white paper with a trace of the original shading
    v = rgb.max(-1, keepdims=True)
    paper = np.clip(np.array([0.97, 0.97, 0.99])[None, None, :] * (0.78 + 0.22 * v / max(v[blob].mean(), 1e-3)), 0, 1)
    w = np.clip(mk['bib'], 0, 1)[..., None]
    rgb[:] = rgb * (1 - w) + paper * w
    area = blob.sum()
    if area < 90: return False
    cnt = cv2.findContours(blob.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    cnt = max(cnt, key=cv2.contourArea)
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(cnt)
    if min(rw, rh) < 7: return False
    # choose the edge closest to horizontal as text axis
    a = ang % 90
    if a > 45: a -= 90        # in -45..45
    if abs(ang % 180 - 90) < 45 or (ang % 180) > 45 and (ang % 180) < 135:
        Lh, Lv = rh, rw
    else:
        Lh, Lv = rw, rh
    if Lh < Lv * 0.55 and a == 0: Lh, Lv = Lv, Lh
    # supersampled text
    S = 4; fs = 120
    font = ImageFont.truetype(FONT, fs)
    tmp = Image.new('L', (fs * 3, fs * 2), 0); d = ImageDraw.Draw(tmp)
    bb = d.textbbox((0, 0), num, font=font); d.text((-bb[0], -bb[1]), num, fill=255, font=font)
    tmp = tmp.crop((0, 0, bb[2] - bb[0], bb[3] - bb[1]))
    tw, th = tmp.size
    k = min(Lh * 0.78 / tw, Lv * 0.7 / th)
    tmp = tmp.resize((max(1, int(tw * k)), max(1, int(th * k))), Image.LANCZOS)
    H_, W_ = rgb.shape[:2]
    big = Image.new('L', (W_, H_), 0)
    big.paste(tmp, (int(round(cx - tmp.width / 2)), int(round(cy - tmp.height / 2))))
    big = big.rotate(-a, center=(cx, cy), resample=Image.BICUBIC)
    t = np.asarray(big).astype(np.float32) / 255 * soft
    ink = np.array([0.08, 0.12, 0.30])[None, None, :]
    rgb[:] = rgb * (1 - t[..., None]) + ink * t[..., None]
    return True

def recolor(frame, mk, suit, fid, seed=0):
    f = frame.astype(np.float32); rgb = f[..., :3] / 255; al = f[..., 3:4]
    H, S, V = hsv_of(rgb)
    w = np.clip(mk['suit'], 0, 1)
    if suit['hue'] is not None:
        Hs = ((H + 60) % 360) - 60
        hh = (suit['hue'] + Hs * 0.35) % 360
        S2 = np.clip(S * suit.get('sat', 1.0), 0, 1)
        V2 = np.clip(V * suit.get('vmul', 1.0) + suit.get('vadd', 0.0) * (V > 0.3), 0, 1)
        if suit.get('sheen'):
            y, x = np.mgrid[:H.shape[0], :H.shape[1]]
            band = 0.5 + 0.5 * np.sin((x * 0.5 - y * 0.35) * 0.09 + fid * 0.9)
            V2 = np.clip(V2 + 0.13 * band * (V > 0.5), 0, 1); S2 = np.clip(S2 - 0.14 * band * (V > 0.5), 0, 1)
        if suit.get('galaxy'):
            y, x = np.mgrid[:H.shape[0], :H.shape[1]]
            hh = (suit['hue'] + 38 * np.sin(x * 0.028 + y * 0.021 + 1.3) + 20 * np.sin(x * 0.011 - y * 0.03)) % 360
            rng = np.random.RandomState(seed + 7)
            stars = (rng.rand(*H.shape) > 0.9965).astype(np.float32)
            stars = nd.gaussian_filter(stars, 0.8); stars = np.clip(stars * 5.5, 0, 1)
            V2 = np.clip(V2 + 0.9 * stars * (V > 0.15), 0, 1); S2 = np.clip(S2 * (1 - 0.8 * stars), 0, 1)
        new = hsv_to_rgb(hh, S2, V2)
        rgb = rgb * (1 - w[..., None]) + new * w[..., None]
    return rgb

def ski_overlay(frame, mk, kind, anchor, fid):
    f = frame.astype(np.float32); rgb = f[..., :3] / 255
    H, S, V = hsv_of(rgb)
    y, x = np.mgrid[:H.shape[0], :H.shape[1]]
    t = np.clip((x - anchor[0]) / SKI_LEN + 0.5, 0, 1)
    if kind == 'flame':
        hh = 2 + 52 * t ** 1.4; S2 = np.full_like(H, 0.95); V2 = np.clip(V * 1.2 + 0.28, 0, 1)
    else:
        hh = (360 * t * 1.05) % 360; S2 = np.full_like(H, 0.85); V2 = np.clip(V * 1.1 + 0.18, 0, 1)
    new = hsv_to_rgb(hh, S2, V2)
    w = np.clip(mk['ski'] * 1.6, 0, 1)
    out = np.dstack([new * 255, f[..., 3] * w]).clip(0, 255).astype(np.uint8)
    return out

# ---------------------------------------------------------------- main build
def build(write=True):
    anims = build_frames()
    items = []
    for ai, a in enumerate(anims):
        for fi, f in enumerate(a['frames']):
            items.append(((ai, fi), f.shape[1] + 2 * PAD, f.shape[0] + 2 * PAD))
    pages = shelf_pack(items)
    sizes = []
    for p in pages:
        w = max(pos[0] + [it for it in items if it[0] == k][0][1] for k, pos in p['pos'].items())
        sizes.append((min(2048, pot(w)) if False else 2048, min(2048, pot(p['H']) if p['H'] > 1024 else (p['H'] + 3) // 4 * 4)))
    print('pages:', len(pages), [(s, len(p['pos'])) for s, p in zip(sizes, pages)])
    where = {}
    for pi, p in enumerate(pages):
        for k, (x, y) in p['pos'].items(): where[k] = (pi, x + PAD, y + PAD)
    meta = {'ppm_ref_ski': SKI_LEN, 'pages': [], 'anims': {}}
    for a in anims:
        sp = a['sp']
        meta['anims'][sp['name']] = dict(fps=sp['fps'], loop=sp['loop'], frames=[])
    for ai, a in enumerate(anims):
        for fi, f in enumerate(a['frames']):
            pi, x, y = where[(ai, fi)]
            meta['anims'][a['sp']['name']]['frames'].append(dict(p=pi, x=x, y=y, w=f.shape[1], h=f.shape[0],
                ax=round(a['anchors'][fi][0], 1), ay=round(a['anchors'][fi][1], 1)))
    meta['pages'] = [dict(w=s[0], h=s[1]) for s in sizes]
    # render per suit
    bibreport = []
    def render(fn):
        atl = [np.zeros((s[1], s[0], 4), np.uint8) for s in sizes]
        for ai, a in enumerate(anims):
            for fi, f in enumerate(a['frames']):
                pi, x, y = where[(ai, fi)]
                out = fn(ai, fi, a, f)
                atl[pi][y:y + out.shape[0], x:x + out.shape[1]] = out
        for im in atl: bleed(im)
        return atl
    suit_frames = {}
    for si, suit in enumerate(SUITS):
        def fn(ai, fi, a, f, suit=suit, si=si):
            mk = masks(f)
            rgb = recolor(f, mk, suit, fi, seed=ai * 31 + fi)
            ok = stamp_bib(rgb, mk, suit['num'], None)
            if si == 0 and not ok: bibreport.append('%s#%d' % (a['sp']['name'], fi + 1))
            out = np.dstack([rgb * 255, f[..., 3]]).clip(0, 255).astype(np.uint8)
            suit_frames[(suit['id'], ai, fi)] = out
            return out
        atl = render(fn)
        if write:
            for pi, im in enumerate(atl):
                Image.fromarray(im).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(OUT + 'suit_%s_%d.png' % (suit['id'], pi), optimize=True)
    for kind in ('flame', 'rainbow'):
        def fn(ai, fi, a, f, kind=kind):
            return ski_overlay(f, masks(f), kind, a['anchors'][fi], fi)
        atl = render(fn)
        if write:
            for pi, im in enumerate(atl): Image.fromarray(im).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(OUT + 'ski_%s_%d.png' % (kind, pi), optimize=True)
    if write: json.dump(meta, open(OUT + 'sprites.json', 'w'), separators=(',', ':'))
    print('bib number not drawn on:', bibreport)
    return anims, suit_frames, meta

def previews(anims, suit_frames):
    for ai, a in enumerate(anims):
        fr = [suit_frames[('wyatt', ai, fi)] for fi in range(len(a['frames']))]
        contact(a, fr, PRE + 'strip_%s.png' % a['sp']['name'], bgmode='sky')
    # 6 suits side-by-side: flight #1 + cheerShow #1 + crouch #1 for each suit
    pick = [(3, 0), (8, 0), (1, 0)]
    cols = []
    for suit in SUITS:
        col = []
        for ai, fi in pick: col.append(suit_frames[(suit['id'], ai, fi)])
        cols.append(col)
    cw = max(f.shape[1] for c in cols for f in c) + 20
    rh = [max(c[r].shape[0] for c in cols) + 20 for r in range(len(pick))]
    W = cw * 6; H = sum(rh) + 44
    im = Image.fromarray(np.full((H, W, 3), (118, 168, 214), np.uint8)); dr = ImageDraw.Draw(im)
    for i, (suit, col) in enumerate(zip(SUITS, cols)):
        y = 30
        dr.text((i * cw + 10, 8), '%s  #%s' % (suit['name'], suit['num']), fill=(255, 255, 255))
        for r, f in enumerate(col):
            reg = np.asarray(im).astype(np.float32)[y:y + f.shape[0], i * cw + 10:i * cw + 10 + f.shape[1]]
            im.paste(Image.fromarray(comp(f, reg).astype(np.uint8)), (i * cw + 10, y)); y += rh[r]
    im.save(PRE + 'suits_all.png')

if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'build':
    anims, sf, meta = build()
    previews(anims, sf)
    for fn in sorted(os.listdir(OUT)): print(fn, os.path.getsize(OUT + fn))
