"""Generate original geometric extension artwork. Optional: Pillow 12+."""
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"


def icon(size):
    scale = 4
    image = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    u = size * scale / 128
    draw.rounded_rectangle((16*u, 16*u, 112*u, 112*u), radius=23*u, fill="#131315")
    for radius, line in ((25, 4), (9, 4)):
        draw.ellipse(((64-radius)*u, (64-radius)*u, (64+radius)*u, (64+radius)*u), outline="white", width=max(1, round(line*u)))
    for angle in range(0, 360, 45):
        a = math.radians(angle)
        draw.line(tuple((64 + r * f(a))*u for r in (34, 41) for f in (math.cos, math.sin)), fill="white", width=max(1, round(4*u)))
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    for size in (16, 32, 48, 96, 128):
        icon(size).save(ASSETS / f"icon-{size}.png")
    image = Image.new("RGB", (440, 280), "#090a10")
    draw = ImageDraw.Draw(image)
    draw.ellipse((-80, 40, 210, 380), fill="#273ad7")
    draw.ellipse((230, -100, 550, 240), fill="#a23997")
    image = image.filter(ImageFilter.GaussianBlur(60))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((68, 50, 372, 230), radius=14, fill="#15151a", outline="#ffffff70", width=2)
    mark = icon(160)
    image.paste(mark, (140, 60), mark)
    image.save(ASSETS / "store-promo-440x280.png")


if __name__ == "__main__":
    main()
