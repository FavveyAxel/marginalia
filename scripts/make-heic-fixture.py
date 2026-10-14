#!/usr/bin/env python3
"""Fabrique hors ligne une vraie image HEIC (HEVC dans un conteneur HEIF) pour les tests.

Usage : python3 -I scripts/make-heic-fixture.py <source.png|jpg> <sortie.heic>
- ffmpeg (libx265) encode l'image en une seule trame IDR (flux Annex B) ;
- ce script range VPS / SPS / PPS dans la boîte hvcC et la tranche dans mdat,
  avec les boîtes minimales d'un fichier HEIC lisible par libheif (ftyp, meta, iloc, iinf, iprp).
Aucun accès réseau.
"""
import os
import struct
import subprocess
import sys
import tempfile

src, out = sys.argv[1], sys.argv[2]


def box(kind, payload):
    return struct.pack('>I', 8 + len(payload)) + kind + payload


def fullbox(kind, version, flags, payload):
    return box(kind, struct.pack('>I', (version << 24) | flags) + payload)


def probe_size(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    w, h = r.stdout.strip().split(',')[:2]
    return int(w), int(h)


w, h = probe_size(src)
with tempfile.TemporaryDirectory() as tmp:
    raw = os.path.join(tmp, 'image.hevc')
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx265',
         '-x265-params', 'keyint=1:info=0:log-level=error:repeat-headers=0', '-crf', '24', '-f', 'hevc', raw],
        check=True,
    )
    data = open(raw, 'rb').read()

# Découpe Annex B → NAL
nals = []
i = 0
starts = []
while True:
    j = data.find(b'\x00\x00\x01', i)
    if j < 0:
        break
    starts.append(j + 3)
    i = j + 3
for k, s in enumerate(starts):
    e = starts[k + 1] - 3 if k + 1 < len(starts) else len(data)
    nal = data[s:e]
    while nal.endswith(b'\x00'):
        nal = nal[:-1]
    nals.append(nal)

by_type = {}
slices = []
for n in nals:
    t = (n[0] >> 1) & 0x3F
    if t in (32, 33, 34):
        by_type.setdefault(t, n)
    elif t < 32:
        slices.append(n)
vps, sps, pps = by_type[32], by_type[33], by_type[34]

# profile_tier_level : octets 3..14 du SPS (après l'en-tête NAL de 2 octets et 1 octet d'identifiants)
ptl = sps[3:15]
hvcc = bytes([1, ptl[0]]) + ptl[1:5] + ptl[5:11] + bytes([ptl[11]])
hvcc += struct.pack('>H', 0xF000) + bytes([0xFC, 0xFC | 1, 0xF8, 0xF8]) + struct.pack('>H', 0) + bytes([0x0F, 3])
for t, n in ((32, vps), (33, sps), (34, pps)):
    hvcc += bytes([0x80 | t]) + struct.pack('>HH', 1, len(n)) + n

item_data = b''.join(struct.pack('>I', len(n)) + n for n in slices)

ftyp = box(b'ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heic')
hdlr = fullbox(b'hdlr', 0, 0, struct.pack('>I', 0) + b'pict' + b'\x00' * 12 + b'\x00')
pitm = fullbox(b'pitm', 0, 0, struct.pack('>H', 1))
infe = fullbox(b'infe', 2, 0, struct.pack('>HH', 1, 0) + b'hvc1' + b'\x00')
iinf = fullbox(b'iinf', 0, 0, struct.pack('>H', 1) + infe)
ispe = fullbox(b'ispe', 0, 0, struct.pack('>II', w, h))
ipco = box(b'ipco', box(b'hvcC', hvcc) + ispe)
ipma = fullbox(b'ipma', 0, 0, struct.pack('>IHB', 1, 1, 2) + bytes([0x80 | 1, 2]))
iprp = box(b'iprp', ipco + ipma)


def build(offset):
    # iloc v0 : offset_size 4, length_size 4, base_offset_size 0 ; 1 élément, 1 étendue
    iloc = fullbox(b'iloc', 0, 0, bytes([0x44, 0x00]) + struct.pack('>HHHHII', 1, 1, 0, 1, offset, len(item_data)))
    return fullbox(b'meta', 0, 0, hdlr + pitm + iloc + iinf + iprp)


meta = build(0)
offset = len(ftyp) + len(meta) + 8
meta = build(offset)
with open(out, 'wb') as f:
    f.write(ftyp + meta + box(b'mdat', item_data))
print(out, w, h, len(item_data))
