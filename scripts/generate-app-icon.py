from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SCALE = 3
SIZE = 512
image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

def xy(values):
    return tuple(round(value * SCALE) for value in values)

def gradient(rect, top, bottom, radius):
    x0, y0, x1, y1 = xy(rect)
    color = Image.new("RGBA", (x1 - x0, y1 - y0))
    pixels = color.load()
    for y in range(y1 - y0):
        t = y / max(1, y1 - y0 - 1)
        mixed = tuple(round(top[c] * (1 - t) + bottom[c] * t) for c in range(3)) + (255,)
        for x in range(x1 - x0):
            pixels[x, y] = mixed
    mask = Image.new("L", color.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, color.width - 1, color.height - 1), radius=radius * SCALE, fill=255)
    image.paste(color, (x0, y0), mask)

gradient((22, 22, 490, 490), (32, 45, 55), (16, 23, 30), 112)
draw = ImageDraw.Draw(image)
draw.rounded_rectangle(xy((22, 22, 490, 490)), radius=112 * SCALE, outline=(255, 255, 255, 44), width=2 * SCALE)
paper = [(150, 78), (319, 78), (374, 133), (374, 433), (150, 433)]
draw.polygon([xy(point) for point in paper], fill=(246, 245, 238, 255))
draw.polygon([xy(point) for point in [(319, 78), (319, 134), (374, 134)]], fill=(220, 219, 210, 255))
draw.line([xy(point) for point in [(319, 78), (319, 134), (374, 134)]], fill=(206, 204, 193, 255), width=3 * SCALE, joint="curve")

font_path = Path(r"C:\Windows\Fonts\seguisym.ttf")
symbol_font = ImageFont.truetype(str(font_path), 184 * SCALE)
bbox = draw.textbbox((0, 0), "Σ", font=symbol_font, stroke_width=0)
symbol_width = bbox[2] - bbox[0]
symbol_height = bbox[3] - bbox[1]
center_x, center_y = xy((260, 238))
symbol_x = center_x - symbol_width // 2 - bbox[0]
symbol_y = center_y - symbol_height // 2 - bbox[1] - 7 * SCALE
draw.text((symbol_x, symbol_y), "Σ", font=symbol_font, fill=(188, 151, 89, 255))
draw.line([xy(point) for point in [(197, 331), (311, 331)]], fill=(190, 192, 188, 255), width=11 * SCALE)
draw.line([xy(point) for point in [(197, 356), (285, 356)]], fill=(190, 192, 188, 255), width=11 * SCALE)
draw.line([xy(point) for point in [(197, 388), (258, 388)]], fill=(112, 151, 141, 255), width=11 * SCALE)
draw.ellipse(xy((325, 368, 353, 396)), fill=(112, 151, 141, 255))

image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
image.save(ROOT / "build" / "app-icon.png")
image.save(ROOT / "build" / "app-icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("Wrote app icons to the build folder.")
