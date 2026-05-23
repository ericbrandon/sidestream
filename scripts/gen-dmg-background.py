#!/usr/bin/env python3
"""Generate the Sidestream DMG background (light bg + a 'drag here' arrow).

Renders supersampled for smooth anti-aliased edges, then writes a 1x and @2x PNG
and combines them into a HiDPI TIFF (dmgbuild's recommended retina approach).

Run with the venv python:  .dmgbuild-venv/bin/python scripts/gen-dmg-background.py
Then:  tiffutil -cathidpicheck scripts/dmg-background.png scripts/dmg-background@2x.png \
           -out scripts/dmg-background.tiff

Layout must match scripts/dmg-settings.py: 660x400 window, app icon @ (180,170),
Applications @ (480,170), 128px icons. The arrow sits in the gap between them at
icon-center height.
"""
import os
from PIL import Image, ImageDraw

W, H = 660, 400
SS = 4  # supersample factor for anti-aliasing
BG = (245, 245, 247, 255)        # near-white light gray
ARROW = (148, 148, 156, 255)     # tasteful medium gray

here = os.path.dirname(os.path.abspath(__file__))

img = Image.new("RGBA", (W * SS, H * SS), BG)
d = ImageDraw.Draw(img)

def s(v):  # scale 1x coord to supersampled space
    return int(round(v * SS))

# Arrow geometry in 1x coords. Icons span x:116-244 (app) and x:416-544 (Apps),
# so the clear gap is x:244-416. Arrow centered in it, at icon-center y=170.
y = 170
shaft_x0 = 264
tip_x = 396
shaft_h = 16        # shaft thickness
head_w = 44         # arrowhead base height
head_len = 36       # arrowhead length
shaft_x1 = tip_x - head_len

# shaft (square ends)
d.rectangle(
    [s(shaft_x0), s(y - shaft_h / 2), s(shaft_x1), s(y + shaft_h / 2)],
    fill=ARROW,
)
# arrowhead (triangle)
d.polygon(
    [(s(shaft_x1), s(y - head_w / 2)), (s(shaft_x1), s(y + head_w / 2)), (s(tip_x), s(y))],
    fill=ARROW,
)

png1 = os.path.join(here, "dmg-background.png")
png2 = os.path.join(here, "dmg-background@2x.png")
img.resize((W, H), Image.LANCZOS).convert("RGB").save(png1)
img.resize((W * 2, H * 2), Image.LANCZOS).convert("RGB").save(png2)
print("wrote", png1)
print("wrote", png2)
