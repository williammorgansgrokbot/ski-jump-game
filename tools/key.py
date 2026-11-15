# chroma-key painted assets (green #00FF00 / magenta #FF00FF screens) -> PNG with alpha, cropped & resized
import sys, numpy as np
from PIL import Image, ImageFilter
import scipy.ndimage as nd
def key(path, screen='green', t0=40, t1=110, hole_min=4000, dom0=60):
    im = Image.open(path).convert('RGB'); a = np.asarray(im).astype(np.float32)
    bgc = np.array([0, 255, 0] if screen == 'green' else [255, 0, 255], np.float32)
    # estimate actual bg from borders
    b = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    bgc = np.median(b, 0) if np.linalg.norm(np.median(b, 0) - bgc) < 120 else bgc
    d = np.sqrt(((a - bgc) ** 2).sum(-1))
    if screen == 'green': dom = a[..., 1] - np.maximum(a[..., 0], a[..., 2])
    else: dom = np.minimum(a[..., 0], a[..., 2]) - a[..., 1]
    score = np.maximum(np.clip((t1 - d) / (t1 - t0), 0, 1), np.clip((dom - dom0) / 60, 0, 1))
    alpha = 1 - score
    # keep only foreground components connected to meaningful mass; flood interior holes of bg that touch border only
    bgmask = alpha < 0.5
    lab, n = nd.label(bgmask); border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sizes = nd.sum(bgmask, lab, range(1, n + 1))
    keepbg = np.zeros_like(bgmask)
    for i, s in enumerate(sizes, 1):
        if i in border or s > hole_min: keepbg |= (lab == i)
    alpha = np.where(keepbg, 0.0, np.maximum(alpha, 0.0))
    alpha = np.where(keepbg, 0, np.where(bgmask, 1.0, alpha))
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255
    rgb = a.copy()
    if screen == 'green':
        sp = np.clip(rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2]), 0, None) * (alpha < 0.97) * 0.95
        rgb[..., 1] -= sp
        # stronger despill near edges
        edge = nd.binary_dilation(alpha < 0.5, iterations=3) & (alpha > 0.0)
        m = np.maximum(rgb[..., 0], rgb[..., 2]); rgb[..., 1] = np.where(edge, np.minimum(rgb[..., 1], m), rgb[..., 1])
    else:
        edge = nd.binary_dilation(alpha < 0.5, iterations=3) & (alpha > 0.0)
        g = rgb[..., 1]; rgb[..., 0] = np.where(edge, np.minimum(rgb[..., 0], np.maximum(g, 60) + 40), rgb[..., 0]); rgb[..., 2] = np.where(edge, np.minimum(rgb[..., 2], np.maximum(g, 60) + 40), rgb[..., 2])
    out = np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')
def fin(im, width, out, pad=4, bottom_crop=False):
    bb = im.getbbox(); im = im.crop(bb)
    w, h = im.size; s = width / w; im = im.resize((width, max(1, int(h * s))), Image.LANCZOS)
    im.save(out, optimize=True); print(out, im.size)
if __name__ == '__main__':
    R = 'art_src/'; O = 'art/'
    jobs = [('logo', 'green', 900), ('crowd_a', 'green', 1400), ('crowd_b', 'green', 1400), ('dog_stormy', 'green', 460), ('dog_emma', 'green', 460),
            ('banner', 'green', 900), ('medal', 'green', 360), ('trophy', 'green', 300), ('btn_go', 'magenta', 300), ('btn_pill', 'magenta', 520),
            ('bunting', 'green', 1100), ('ridge', 'green', 1600), ('cloud', 'green', 520), ('burst', 'green', 760), ('puff', 'green', 300)]
    only = sys.argv[1:]
    for n, scr, w in jobs:
        if only and n not in only: continue
        fin(key(R + n + '_raw.jpg', scr), w, O + n + '.png')
