"""Tile captures into one labelled contact sheet: python tools/sheet.py out.jpg cols tileWidth a.jpg b.jpg ..."""
import sys
from PIL import Image, ImageDraw

out, cols, tile = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
paths = sys.argv[4:]
images = [Image.open(p).convert("RGB") for p in paths]
th = int(tile * images[0].height / images[0].width)
rows = (len(images) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (tile + 4) + 4, rows * (th + 4) + 4), (16, 16, 20))
draw = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(images, paths)):
    x, y = 4 + (i % cols) * (tile + 4), 4 + (i // cols) * (th + 4)
    sheet.paste(im.resize((tile, th), Image.LANCZOS), (x, y))
    label = p.replace("\\", "/").split("/")[-1].rsplit(".", 1)[0]
    draw.rectangle([x, y, x + 8 + 7 * len(label), y + 16], fill=(0, 0, 0))
    draw.text((x + 4, y + 2), label, fill=(255, 220, 90))
sheet.save(out, quality=90)
print(out, sheet.size)
