"""Paints frames.json as a terminal window: a sample status line, then the crab."""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

frames_path, out_path = sys.argv[1], sys.argv[2]
data = json.load(open(frames_path, encoding="utf-8"))
WIDTH_COLS = data["width"]

S = 2  # drawn at 2x, so it stays sharp on high-DPI screens
SIZE = 14 * S
mono = ImageFont.truetype("C:/Windows/Fonts/CascadiaMono.ttf", SIZE)
emoji = ImageFont.truetype("C:/Windows/Fonts/seguiemj.ttf", SIZE)
CELL_W = mono.getlength("M")
LINE_H = SIZE + 10 * S
PAD_X, PAD_TOP, BAR_H = 16 * S, 14 * S, 28 * S

BG = (24, 24, 27)
BAR = (39, 39, 42)
TEXT = (212, 212, 216)
DIM = (113, 113, 122)
GREEN = (74, 222, 128)
BLUE = (96, 165, 250)
ACCENT = (217, 119, 87)

# The status line above the crab: a typical one, colored like a terminal's.
STATUS = [
    ("opus high  |  ", TEXT),
    ("context [████░░░░░░] 42%", GREEN),
    ("  |  ", TEXT),
    ("session [██████░░░░] 64%", BLUE),
    ("  resets in 1h 23m  weekly 12%", TEXT),
]


def hex_rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def is_emoji(ch):
    return ord(ch) >= 0x1F000


def draw_runs(draw, img, runs, x0, y):
    """Draws (text, rgb) runs on the grid: emoji take two cells, text one."""
    col = 0
    for text, rgb in runs:
        for ch in text:
            if ord(ch) in (0xFE0F, 0x200D):
                continue
            x = x0 + col * CELL_W
            if is_emoji(ch):
                # Colour emoji drawn centred in their two cells.
                w = emoji.getlength(ch)
                draw.text((x + (2 * CELL_W - w) / 2, y - 2 * S), ch, font=emoji, embedded_color=True)
                col += 2
            else:
                draw.text((x, y), ch, font=mono, fill=rgb)
                col += 1


width_px = round(PAD_X * 2 + WIDTH_COLS * CELL_W)
height_px = BAR_H + PAD_TOP + LINE_H * 3 + 14 * S

images = []
for segments in data["frames"]:
    img = Image.new("RGB", (width_px, height_px), BG)
    d = ImageDraw.Draw(img)
    # Window bar with the three dots.
    d.rectangle([0, 0, width_px, BAR_H], fill=BAR)
    for k, c in enumerate([(239, 68, 68), (234, 179, 8), (34, 197, 94)]):
        d.ellipse([(12 + k * 18) * S, 9 * S, (23 + k * 18) * S, 20 * S], fill=c)
    d.text((width_px / 2, BAR_H / 2), "claude", font=mono, fill=DIM, anchor="mm")

    y = BAR_H + PAD_TOP
    d.text((PAD_X, y), ">", font=mono, fill=ACCENT)
    d.rectangle([PAD_X + 2 * CELL_W, y + 2 * S, PAD_X + 3 * CELL_W, y + SIZE + 2 * S], fill=TEXT)
    y += LINE_H
    draw_runs(d, img, STATUS, PAD_X, y)
    y += LINE_H
    runs = [(s["text"], hex_rgb(s["color"]) if s.get("color") else (DIM if s.get("dim") else TEXT)) for s in segments]
    draw_runs(d, img, runs, PAD_X, y)
    images.append(img)

# One shared palette keeps the file small and the colours steady.
palette_src = images[len(images) // 2].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=palette_src, dither=Image.Dither.NONE) for im in images]
frames[0].save(
    out_path,
    save_all=True,
    append_images=frames[1:],
    duration=450,
    loop=0,
    optimize=True,
    disposal=1,
)
print(out_path, len(frames), "frames", width_px, "x", height_px)
