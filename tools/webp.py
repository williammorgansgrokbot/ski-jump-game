# Convert shipped art PNGs to WebP (iOS 14+/current Safari). Keeps apple-touch-icon / icon_512 as PNG.
import os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = {'apple-touch-icon.png', 'icon_512.png'}
def conv(path, q, lossless=False):
    im = Image.open(path).convert('RGBA')
    out = path[:-4] + '.webp'
    im.save(out, 'WEBP', quality=q, alpha_quality=100, method=6, lossless=lossless)
    return os.path.getsize(path), os.path.getsize(out)
tot0 = tot1 = 0
for d, q in (('art', 86),):
    for f in sorted(os.listdir(os.path.join(ROOT, d))):
        if not f.endswith('.png') or f in KEEP: continue
        a, b = conv(os.path.join(ROOT, d, f), q); tot0 += a; tot1 += b; print(f, a // 1024, '->', b // 1024, 'KB')
print('total', tot0 // 1024, '->', tot1 // 1024, 'KB')

# sprite atlases: lossless WebP of the palette-quantised atlas (smaller than PNG, pixel identical)
for f in sorted(os.listdir(os.path.join(ROOT, 'art/sprites'))):
    if f.endswith('.png'):
        p = os.path.join(ROOT, 'art/sprites', f); Image.open(p).convert('RGBA').save(p[:-4] + '.webp', 'WEBP', lossless=True, method=6)
