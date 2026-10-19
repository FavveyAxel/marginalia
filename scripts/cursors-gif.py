# Animation des pointeurs (scripts/test-cursors.mjs) :
#  - captures d'écran prises chez Marc pendant que Léa bouge → GIF (≈ 8 images/s : une capture prend du temps) ;
#  - trajectoire relevée chez Marc à chaque image affichée (≈ 60/s) et positions reçues du réseau → PNG ;
#  - reconstitution à 50 images/s : le pointeur dessiné aux positions RELEVÉES chez Marc, image par image,
#    sur une capture du fond (montre la fluidité que les captures, trop lentes, ne peuvent pas montrer).
# Usage : python3 scripts/cursors-gif.py <dossier d'images> <sortie.gif> <trajectoire.json> <sortie.png> [<sortie-60ips.gif>]
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size):
    for f in ('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


src, out_gif, track_json, out_png = sys.argv[1:5]
names = sorted(f for f in os.listdir(src) if f.endswith('.png') and f.startswith('f'))
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
    d.text((14, 12), f'{len(pts)} images affichées chez Marc (points pleins), {len(data.get("raw", []))} positions reçues (cercles verts)', fill=(29, 26, 21), font=font(22))
    img.save(out_png)
    print(f'Trajectoire : {len(pts)} points → {out_png}')

# Reconstitution image par image.
if len(sys.argv) > 5 and os.path.exists(os.path.join(src, 'fond.png')) and len(pts) > 2:
    out60 = sys.argv[5]
    bg = Image.open(os.path.join(src, 'fond.png')).convert('RGB')
    bx, by = data['box']['x'], data['box']['y']
    sx = bg.width / data['box']['width']
    hexc = data.get('color', '#c2410c').lstrip('#')
    col = tuple(int(hexc[i:i + 2], 16) for i in (0, 2, 4))
    arrow = [(1.6, 1.4), (1.6, 16.8), (5.7, 12.9), (8.6, 19.2), (11.5, 17.9), (8.7, 11.7), (14.4, 11.7)]
    out = []
    for x, y in pts:
        f = bg.copy()
        d = ImageDraw.Draw(f)
        ox, oy = (x - bx) * sx, (y - by) * sx
        poly = [(ox + (ax - 1.6) * sx, oy + (ay - 1.4) * sx) for ax, ay in arrow]
        d.polygon(poly, fill=col, outline=(255, 255, 255))
        lx, ly = ox + 14 * sx, oy + 17 * sx
        d.rounded_rectangle((lx, ly, lx + 30 * sx, ly + 17 * sx), radius=6 * sx, fill=col)
        d.text((lx + 6 * sx, ly + 2 * sx), data.get('name', ''), fill=(255, 255, 255), font=font(int(11.5 * sx)))
        out.append(f.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    out[0].save(out60, save_all=True, append_images=out[1:], duration=20, loop=0, optimize=False)
    print(f'Reconstitution : {len(out)} images à 50 i/s → {out60}')
