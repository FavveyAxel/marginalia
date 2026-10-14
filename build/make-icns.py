#!/usr/bin/env python3
"""Assemble build/icon.icns depuis build/icon.png (entrées PNG ic07–ic14)."""
import io
import os
import struct
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
src = Image.open(os.path.join(here, "icon.png")).convert("RGBA")
assert src.size == (1024, 1024), src.size

# type -> côté en pixels
entries = [
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),  # 512@2x
    ("ic11", 32),    # 16@2x
    ("ic12", 64),    # 32@2x
    ("ic13", 256),   # 128@2x
    ("ic14", 512),   # 256@2x
]
body = b""
for code, px in entries:
    im = src if px == 1024 else src.resize((px, px), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    body += code.encode("ascii") + struct.pack(">I", 8 + len(data)) + data
out = b"icns" + struct.pack(">I", 8 + len(body)) + body
with open(os.path.join(here, "icon.icns"), "wb") as f:
    f.write(out)
print("build/icon.icns écrit", len(out), "octets")
