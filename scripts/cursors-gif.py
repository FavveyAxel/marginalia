# Animation des pointeurs (scripts/test-cursors.mjs) : images prises chez Marc → GIF ; trajectoire
# échantillonnée à chaque image → PNG (points reçus du réseau inutiles : on trace ce que l'écran montre).
# Usage : python3 scripts/cursors-gif.py <dossier d'images> <sortie.gif> <trajectoire.json> <sortie.png>
import json
import os
import sys

from PIL import Image, ImageDraw

src, out_gif, track_json, out_png = sys.argv[1:5]
names = sorted(f for f in os.listdir(src) if f.endswith('.png'))
stamps = json.load(open(os.path.join(src, 'stamps.json')))
frames = [Image.open(os.path.join(src, n)).convert('RGB') for n in names]
if frames:
    durs = [max(20, int(stamps[i + 1] - stamps[i])) if i + 1 < len(stamps) else 120 for i in range(len(frames))]
    pal = [f.quantize(colors=255, method=Image.Quantize.MEDIANCUT) for f in frames]
    pal[0].save(out_gif, save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True)
    print(f'GIF : {len(frames)} images, {sum(durs) / 1000:.1f} s → {out_gif}')

# Trajectoire : chaque point = une image affichée chez Marc (≈ 60 par seconde).
data = json.load(open(track_json))
pts = [(p[1], p[2]) for p in data['track']]
if len(pts) > 2:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    pad = 30
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = int(max(xs) - x0 + pad), int(max(ys) - y0 + pad)
    k = 2
    img = Image.new('RGB', (w * k, h * k), (251, 249, 244))
    d = ImageDraw.Draw(img)
    d.line([((x - x0) * k, (y - y0) * k) for x, y in pts], fill=(29, 78, 216), width=2)
    for x, y in pts:
        d.ellipse(((x - x0) * k - 3, (y - y0) * k - 3, (x - x0) * k + 3, (y - y0) * k + 3), fill=(194, 65, 12))
    # Positions reçues du réseau (≈ 25 par seconde) : cercles vides.
    for r in data.get('raw', []):
        x, y = r[1], r[2]
        d.ellipse(((x - x0) * k - 7, (y - y0) * k - 7, (x - x0) * k + 7, (y - y0) * k + 7), outline=(21, 128, 61), width=2)
    d.text((10, 10), f'{len(pts)} images affichees chez Marc (points pleins), {len(data.get("raw", []))} positions recues (cercles verts)', fill=(29, 26, 21))
    img.save(out_png)
    print(f'Trajectoire : {len(pts)} points → {out_png}')
