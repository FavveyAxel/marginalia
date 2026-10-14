#!/usr/bin/env python3
"""Fixture image pour le moteur image (OCR) : photo simulée d'une page du Discours de la méthode.

Usage : python3 -I scripts/make-image-fixture.py <sortie.jpg> <verite.txt> [--clean]
- page papier légèrement jaunie, éclairage inégal, posée sur un fond plus sombre ;
- rotation de 1,2°, bruit gaussien, léger flou, JPEG qualité 82 (comme une photo de téléphone) ;
- --clean : même page sans rotation ni bruit (pour comparer).
Écrit aussi le texte exact rendu (vérité terrain) dans <verite.txt>.
"""
import random
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = __file__.rsplit('/scripts/', 1)[0]
out_img, out_txt = sys.argv[1], sys.argv[2]
clean = '--clean' in sys.argv
random.seed(7)
np.random.seed(7)

md = open(f'{ROOT}/fixtures/discours.md', encoding='utf-8').read()
body = md.split('# Première partie', 1)[1].split('# Seconde partie', 1)[0]
paras = [re.sub(r'\s+', ' ', p.strip().replace("'", '’')) for p in body.split('\n\n') if p.strip()]
paras = [p for p in paras if not p.startswith('#')]

W, H = 1600, 2240
MARGIN_X, TOP = 150, 170
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 33)
title_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 52)
LINE = 50

page = Image.new('L', (W, H), 236)
d = ImageDraw.Draw(page)
truth_lines = ['Première partie', '']
tw = d.textlength('Première partie', font=title_font)
d.text(((W - tw) / 2, TOP), 'Première partie', font=title_font, fill=28)
y = TOP + 130
maxw = W - 2 * MARGIN_X
for p in paras:
    words = p.split(' ')
    line = ''
    first = True
    for w in words:
        cand = (line + ' ' + w).strip()
        indent = 50 if first else 0
        if d.textlength(cand, font=font) + indent > maxw and line:
            d.text((MARGIN_X + indent, y), line, font=font, fill=30)
            truth_lines.append(line)
            y += LINE
            line = w
            first = False
        else:
            line = cand
        if y > H - 200:
            break
    if y > H - 200:
        break
    d.text((MARGIN_X + (50 if first else 0), y), line, font=font, fill=30)
    truth_lines.append(line)
    truth_lines.append('')
    y += LINE + 18

if not clean:
    # Éclairage inégal (plus sombre en bas à droite) et grain du papier.
    yy, xx = np.mgrid[0:H, 0:W]
    light = 1.0 - 0.16 * ((xx / W) * 0.6 + (yy / H) * 0.4)
    arr = np.asarray(page, dtype=np.float32) * light
    arr += np.random.normal(0, 7, arr.shape)
    page = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    # Posée sur une table, photographiée de travers.
    bg = Image.new('L', (W + 180, H + 200), 92)
    bg.paste(page, (90, 100))
    rot = bg.rotate(1.2, resample=Image.BICUBIC, expand=False, fillcolor=92)
    rot = rot.filter(ImageFilter.GaussianBlur(0.7))
    arr = np.asarray(rot, dtype=np.float32) + np.random.normal(0, 5, (rot.size[1], rot.size[0]))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('RGB')
    # Teinte chaude de photo.
    r, g, b = img.split()
    img = Image.merge('RGB', (r.point(lambda v: min(255, v + 6)), g, b.point(lambda v: max(0, v - 10))))
else:
    img = page.convert('RGB')

img.save(out_img, 'JPEG', quality=82)
open(out_txt, 'w', encoding='utf-8').write('\n'.join(truth_lines).strip() + '\n')
print(out_img, img.size)
