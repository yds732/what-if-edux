"""Crops a region of an image and enlarges it: python tools/crop.py in.jpg out.jpg x y w h [scale]"""
import sys
from PIL import Image

src, dst, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 3
im = Image.open(src).crop((x, y, x + w, y + h))
im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
im.save(dst, quality=92)
print(dst, im.size)
