#!/usr/bin/env python3
"""Export the original app.svg offline: python3 tools/export-app-icons.py.

Requires Python 3 + Pillow (also used by local-extract). This deliberately renders
only this source's flat rect/polygon vocabulary; unsupported SVG fails loudly.
No fonts, game art, browser, network or platform image service is involved.
"""
import argparse
from io import BytesIO
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/icons/app.svg"
MASK_SCALE = 0.875


def render(size, maskable=False):
    svg = ET.parse(SOURCE).getroot()
    if svg.attrib != {"width": "512", "height": "512", "viewBox": "0 0 512 512"}:
        raise ValueError("Expected the 512-square SVG master")
    # Eight samples per output pixel, then area averaging; no ringing beyond the mark.
    scale = size * 8 / 512
    image = Image.new("RGB", (size * 8, size * 8))
    draw = ImageDraw.Draw(image)

    def paint(element, inset=1):
        tag = element.tag.rsplit("}", 1)[-1]
        attrs = element.attrib
        if tag in ("title", "desc"):
            if attrs or len(element):
                raise ValueError("Unsupported metadata")
            return
        if tag == "g" and attrs == {"id": "mark"}:
            for child in element:
                paint(child, MASK_SCALE if maskable else 1)
            return
        if tag == "rect" and set(attrs) <= {"x", "y", "width", "height", "fill"}:
            x, y = float(attrs.get("x", 0)), float(attrs.get("y", 0))
            w, h = float(attrs["width"]), float(attrs["height"])
            points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        elif tag == "polygon" and set(attrs) == {"fill", "points"}:
            points = [tuple(map(float, p.split(","))) for p in attrs["points"].split()]
        else:
            raise ValueError(f"Unsupported SVG element/attributes: {tag} {attrs}")
        # Pillow addresses pixel centres; shift the vector edges by half a sample.
        points = [((256 + (x - 256) * inset) * scale - 0.5,
                   (256 + (y - 256) * inset) * scale - 0.5) for x, y in points]
        draw.polygon(points, fill=attrs["fill"])

    for element in svg:
        paint(element)
    return image.resize((size, size), Image.Resampling.BOX)


def write_ico(path):
    # Native-size renders preserve the same pixels as each PNG favicon. Write
    # the DIBs explicitly: Pillow's RGB ICO writer does not pad 1-bit mask rows
    # to 4 bytes, and can reuse the last size's mask for every smaller frame.
    sizes = (16, 32, 48)
    directory, frames = bytearray(), bytearray()
    offset = 6 + 16 * len(sizes)
    for size in sizes:
        dib = BytesIO()
        render(size).save(dib, format="DIB")
        frame = bytearray(dib.getvalue())
        # ICO DIB height includes both the colour bitmap and the AND mask.
        struct.pack_into("<i", frame, 8, size * 2)
        frame.extend(bytes(((size + 31) // 32) * 4 * size))  # Opaque, padded AND rows
        directory.extend(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 24, len(frame), offset))
        frames.extend(frame)
        offset += len(frame)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(sizes)) + directory + frames)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "public/icons")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        for maskable in (False, True):
            name = f"app-{'maskable-' if maskable else ''}{size}.png"
            render(size, maskable).save(args.out / name)
    for size in (16, 32, 48):
        render(size).save(args.out / f"favicon-{size}.png")
    render(180).save(args.out / "apple-touch-icon.png")
    # BMP-backed frames also work in older ICO readers; PNG favicons ship separately.
    write_ico(args.out / "favicon.ico")
    print(f"Exported 9 icon files to {args.out}")


if __name__ == "__main__":
    main()
