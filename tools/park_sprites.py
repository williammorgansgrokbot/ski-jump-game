# Ski Park sprite pipeline: key generated sheets -> slice -> uniform scale -> anchor -> recolor suits -> pack WebP atlases + park.json.
# Reuses the keying / recolor / packing code from sprites.py. All character art comes from GenerateImage sheets in art_src/park.
#   python3 tools/park_sprites.py test    -> contact strips only (previews/sprites/park_*.png), no atlases
#   python3 tools/park_sprites.py build   -> atlases art/sprites/park_suit_<id>_<page>.webp, park_ski_<kind>_<page>.webp, park.json
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sprites as S

ROOT = S.ROOT
S.SRC = ROOT + '/art_src/park/'
OUT = ROOT + '/art/sprites/'
PRE = ROOT + '/previews/sprites/'
os.makedirs(PRE, exist_ok=True)
SKI_LEN = S.SKI_LEN; PAD = 3

# nominal body rotation (deg, CCW positive) that each tumbling frame depicts; the game adds whole-sprite rotation for the residual
BACK = [60, 95, 135, 180, 250, 300]
FRONT = [-30, -45, -65, -180, -235, -345]
ANIMS = [
 dict(name='pride',  file='ride_a.jpg',        rows=2, cols=3, sel=None,      fps=10, loop=True,  air=False),
 dict(name='ppop',   file='poplanding_a.jpg',  rows=2, cols=3, sel=[0, 1],    fps=10, loop=False, air=False),
 dict(name='pair',   file='poplanding_a.jpg',  rows=2, cols=3, sel=[2],       fps=10, loop=True,  air=True),
 dict(name='pland',  file='poplanding_a.jpg',  rows=2, cols=3, sel=[3, 4, 5], fps=9,  loop=False, air=False),
 dict(name='pback',  file='backflip_a.jpg',    rows=2, cols=3, sel=None,      fps=10, loop=False, air=True, ang=BACK),
 dict(name='pfront', file='frontflip_a.jpg',   rows=2, cols=3, sel=None,      fps=10, loop=False, air=True, ang=FRONT),
 dict(name='pspin',  file='spin_a.jpg',        rows=2, cols=4, sel=None,      fps=10, loop=True,  air=True),
 dict(name='pgrind', file='grindgrab_a.jpg',   rows=2, cols=3, sel=[0, 1, 2], fps=8,  loop=True,  air=False),
 dict(name='pgrab',  file='grindgrab_a.jpg',   rows=2, cols=3, sel=[3, 4, 5], fps=8,  loop=True,  air=True),
]

def bbox_center(f):
    ys, xs = np.where(f[..., 3] > 40)
    return ((xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0)

def build_frames():
    cache = {}; out = []
    for sp in ANIMS:
        if sp['file'] not in cache:
            fr = S.load_sheet(sp)
            L = sorted([S.ski_length(f) for f in fr]); ref = L[int(len(L) * 0.8)]      # upper percentile: foreshortened frames must not inflate the scale
            cache[sp['file']] = (fr, SKI_LEN / ref if ref > 0 else 1.0)
            print('%-18s frames=%d ski_len(p80)=%.0f scale=%.3f' % (sp['file'], len(fr), ref, cache[sp['file']][1]))
        fr, s = cache[sp['file']]
        sel = sp['sel'] if sp['sel'] is not None else list(range(len(fr)))
        frames = [S.resize_rgba(fr[i], s) for i in sel]
        anc = [bbox_center(f) if sp['air'] else S.anchor_of(f, s) for f in frames]
        ski_anc = [S.anchor_of(f, s) for f in frames]
        out.append(dict(sp=sp, frames=frames, anchors=anc, ski_anchors=ski_anc, scale=s))
    return out

def contact(anims, path, names=None):
    from PIL import ImageDraw
    sel = [a for a in anims if not names or a['sp']['name'] in names]
    cw = max(f.shape[1] for a in sel for f in a['frames']) + 20; ch = max(f.shape[0] for a in sel for f in a['frames']) + 36
    cols = max(len(a['frames']) for a in sel); W = cw * cols; H = ch * len(sel)
    sheet = S.checker(W, H) if False else np.full((H, W, 3), (118, 168, 214), np.float32)
    im = Image.fromarray(sheet.astype(np.uint8)); dr = ImageDraw.Draw(im)
    for r, a in enumerate(sel):
        for c, f in enumerate(a['frames']):
            ox, oy = c * cw + 10, r * ch + 26
            reg = np.asarray(im).astype(np.float32)[oy:oy + f.shape[0], ox:ox + f.shape[1]]
            im.paste(Image.fromarray(S.comp(f, reg).astype(np.uint8)), (ox, oy))
            ax, ay = a['anchors'][c]
            dr.line([(ox + ax - 7, oy + ay), (ox + ax + 7, oy + ay)], fill=(255, 0, 255)); dr.line([(ox + ax, oy + ay - 7), (ox + ax, oy + ay + 7)], fill=(255, 0, 255))
            dr.text((c * cw + 6, r * ch + 6), '%s #%d' % (a['sp']['name'], c + 1), fill=(255, 255, 255))
    im.save(path)

def build(write=True):
    anims = build_frames()
    items = []
    for ai, a in enumerate(anims):
        for fi, f in enumerate(a['frames']): items.append(((ai, fi), f.shape[1] + 2 * PAD, f.shape[0] + 2 * PAD))
    pages = S.shelf_pack(items, 2048, 2048)
    sizes = [(2048, (p['H'] + 3) // 4 * 4) for p in pages]
    print('pages:', len(pages), sizes, [len(p['pos']) for p in pages])
    where = {}
    for pi, p in enumerate(pages):
        for k, (x, y) in p['pos'].items(): where[k] = (pi, x + PAD, y + PAD)
    meta = {'ppm_ref_ski': SKI_LEN, 'pages': [dict(w=s[0], h=s[1]) for s in sizes], 'anims': {}}
    for ai, a in enumerate(anims):
        sp = a['sp']; ent = dict(fps=sp['fps'], loop=sp['loop'], air=sp['air'], frames=[])
        if 'ang' in sp: ent['ang'] = sp['ang']
        for fi, f in enumerate(a['frames']):
            pi, x, y = where[(ai, fi)]
            ent['frames'].append(dict(p=pi, x=x, y=y, w=f.shape[1], h=f.shape[0], ax=round(a['anchors'][fi][0], 1), ay=round(a['anchors'][fi][1], 1)))
        meta['anims'][sp['name']] = ent
    def render(fn):
        atl = [np.zeros((s[1], s[0], 4), np.uint8) for s in sizes]
        for ai, a in enumerate(anims):
            for fi, f in enumerate(a['frames']):
                pi, x, y = where[(ai, fi)]; out = fn(ai, fi, a, f); atl[pi][y:y + out.shape[0], x:x + out.shape[1]] = out
        for im in atl: S.bleed(im)
        return atl
    def save(atl, stem):
        for pi, im in enumerate(atl):
            Image.fromarray(im).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).convert('RGBA').save(OUT + '%s_%d.webp' % (stem, pi), 'WEBP', lossless=True, method=6)
    suit_frames = {}
    for si, suit in enumerate(S.SUITS):
        def fn(ai, fi, a, f, suit=suit):
            mk = S.masks(f); rgb = S.recolor(f, mk, suit, fi, seed=ai * 31 + fi); S.stamp_bib(rgb, mk, suit['num'], None)
            o = np.dstack([rgb * 255, f[..., 3]]).clip(0, 255).astype(np.uint8); suit_frames[(suit['id'], ai, fi)] = o; return o
        atl = render(fn)
        if write: save(atl, 'park_suit_' + suit['id'])
    for kind in ('flame', 'rainbow', 'neon'):
        def fn(ai, fi, a, f, kind=kind): return S.ski_overlay(f, S.masks(f), kind, a['ski_anchors'][fi], fi)
        atl = render(fn)
        if write: save(atl, 'park_ski_' + kind)
    if write: json.dump(meta, open(OUT + 'park.json', 'w'), separators=(',', ':'))
    return anims, suit_frames, meta

def previews(anims, suit_frames):
    # one strip per anim (Wyatt) + a recolor check (Reid/Galaxy) of the hard frames
    for a in anims:
        ai = anims.index(a); fr = [suit_frames[('wyatt', ai, fi)] for fi in range(len(a['frames']))]
        b = dict(a); b['frames'] = fr
        contact([b], PRE + 'park_%s.png' % a['sp']['name'])
    allw = []
    for suit in ('wyatt', 'reid', 'galaxy'):
        for a in anims:
            if a['sp']['name'] in ('pspin', 'pback'):
                ai = anims.index(a); b = dict(a); b['frames'] = [suit_frames[(suit, ai, fi)] for fi in range(len(a['frames']))]; b['sp'] = dict(a['sp'], name=a['sp']['name'] + '_' + suit); allw.append(b)
    contact(allw, PRE + 'park_suits_check.png')

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'test'
    if mode == 'test':
        anims = build_frames(); contact(anims, PRE + 'park_all_raw.png')
        for a in anims: print(a['sp']['name'], [f.shape[1::-1] for f in a['frames']])
    else:
        anims, sf, meta = build(); previews(anims, sf)
        for fn in sorted(os.listdir(OUT)):
            if fn.startswith('park'): print(fn, os.path.getsize(OUT + fn))
