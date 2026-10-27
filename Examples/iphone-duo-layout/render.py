#!/usr/bin/env python3
"""Render layout-only Duo studies; never reads screenshots or calls a simulator."""
import argparse
from html import escape
import json
import math
from pathlib import Path

from PIL import Image, ImageCms, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
FONT = "/System/Library/Fonts/SFNS.ttf"


def font(size, bold=False):
    face = ImageFont.truetype(FONT, round(size))
    face.set_variation_by_axes([100, min(96, max(17, size)), 400, 700 if bold else 400])
    return face


def centered(draw, text, x, y, size, color, bold=False):
    draw.text((round(x), round(y)), text, font=font(size, bold), fill=color, anchor="mm")


def outline(box, radii):
    x, y, w, h = box
    points = []
    for radius, cx, cy, start in zip(
        radii, [x+radii[0], x+w-radii[1], x+w-radii[2], x+radii[3]],
        [y+radii[0], y+radii[1], y+h-radii[2], y+h-radii[3]], [180, 270, 0, 90]
    ):
        for step in range(33):
            angle = math.radians(start + step * 90 / 32)
            points.append((round(cx + radius * math.cos(angle)), round(cy + radius * math.sin(angle))))
    return points


def render(config, layout):
    w, h = config["canvas"]["width"], config["canvas"]["height"]
    image = Image.new("RGB", (w, h), config["background"])
    draw = ImageDraw.Draw(image)
    caption = config["caption"]
    for index, line in enumerate(caption["lines"]):
        draw.text((w / 2, caption["top"] + index * caption["fontSize"] * caption["lineHeight"]),
                  line, font=font(caption["fontSize"], True), fill=caption["color"], anchor="mt")

    displays = [config["displays"][name] for name in layout["displays"]]
    area, bezel, gap = config["displayArea"], config["bezel"], config["displayGap"]
    scale = min((area["width"] - gap * (len(displays)-1) - 2*bezel*len(displays)) /
                sum(item["width"] for item in displays),
                (area["height"] - 2*bezel) / max(item["height"] for item in displays))
    total = sum(item["width"] * scale + 2*bezel for item in displays) + gap*(len(displays)-1)
    x = area["x"] + (area["width"] - total) / 2
    slots = []
    for name, item in zip(layout["displays"], displays):
        sw, sh = item["width"] * scale, item["height"] * scale
        y = area["y"] + (area["height"] - sh - 2*bezel) / 2
        body = (x, y, sw+2*bezel, sh+2*bezel)
        radii = [r*scale for r in item["corners"]]
        polygon = outline(body, [r+bezel for r in radii])
        shadow = Image.new("RGBA", image.size)
        ImageDraw.Draw(shadow).polygon([(px, py+14) for px, py in polygon], fill=(14, 46, 68, 50))
        image = Image.alpha_composite(image.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(22))).convert("RGB")
        draw = ImageDraw.Draw(image)
        draw.polygon(polygon, fill="#202832")
        draw.line(polygon + [polygon[0]], fill="#53616F", width=3)
        screen = (x+bezel, y+bezel, sw, sh)
        draw.polygon(outline(screen, radii), fill="#EDF3F8")
        cx, cy = x+bezel+sw/2, y+bezel+sh/2
        draw.rounded_rectangle((cx-40, cy-140, cx+40, cy-60), radius=16, outline="#A8B8C6", width=3)
        draw.line((cx-21, cy-100, cx+21, cy-100), fill="#A8B8C6", width=3)
        draw.line((cx, cy-121, cx, cy-79), fill="#A8B8C6", width=3)
        centered(draw, item["label"], cx, cy+3, 42, "#4A6173", True)
        centered(draw, f'{item["width"]} × {item["height"]}', cx, cy+65, 34, "#738697")
        centered(draw, "Screenshot placeholder", cx, cy+123, 29, "#738697")
        slots.append({"display": name, "sourceDimensions": [item["width"], item["height"]],
                      "screenRect": [round(v, 3) for v in screen], "scale": scale})
        x += sw + 2*bezel + gap

    centered(draw, "LAYOUT STUDY  ·  PLACEHOLDERS ONLY", w/2, 1922, 28, "#355B76")
    return image, slots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("~/Desktop/Screenshots/ThisDayAppStore/_prototypes/iphone-duo").expanduser())
    args = parser.parse_args()
    output = args.output.expanduser()
    output.mkdir(parents=True, exist_ok=True)
    config = json.loads((ROOT / "layout.json").read_text())
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    receipt = {"status": "layout-only-not-for-upload", "sourceConfig": str(ROOT / "layout.json"),
               "displayType": config["displayType"], "canvas": config["canvas"], "layouts": []}
    previews = []
    cards = []
    for layout in config["layouts"]:
        image, slots = render(config, layout)
        target = output / (layout["id"] + ".png")
        image.save(target, icc_profile=profile)
        receipt["layouts"].append({"file": target.name, "slots": slots})
        thumb = image.copy()
        thumb.thumbnail((1000, 704), Image.Resampling.LANCZOS)
        previews.append((layout["title"], thumb))
        cards.append(f'<article><h2>{escape(layout["title"])}</h2><a href="{target.name}"><img src="{target.name}" alt="{escape(layout["title"])} layout with labeled screenshot placeholders"></a><p>2853 × 2007 · RGB PNG · <a href="{target.name}" download>Download</a></p></article>')

    sheet = Image.new("RGB", (1072, 850), "#F4F6F8")
    draw = ImageDraw.Draw(sheet)
    for index, (title, preview) in enumerate(previews):
        left = 36 + index*1040
        draw.text((left, 42), title, font=font(30, True), fill="#152C3E", anchor="lt")
        sheet.paste(preview, (left, 100))
    sheet.save(output / "preview.png", icc_profile=profile)
    (output / "manifest.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (output / "index.html").write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>This Day · Duo layout studies</title>
<style>*{box-sizing:border-box}body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;background:#f4f6f8;color:#152c3e;margin:0;padding:40px;line-height:1.55}main{max-width:1000px;margin:auto}h1{font-size:36px;letter-spacing:-1px;margin:0}h2{font-size:20px}header{margin-bottom:28px}p{color:#526575}a{color:#215f88}img{width:100%;display:block;border-radius:12px}article p{font-size:13px}.note{max-width:850px}footer{margin-top:32px;font-size:14px}@media(max-width:850px){body{padding:24px}}</style>
<main><header><p>THIS DAY / IPHONE DUO</p><h1>One device. One landscape set.</h1><p class="note">Chosen layout: a single unfolded view on the accepted 2853 × 2007 landscape canvas. The headline sits 48 pixels lower to better balance the space above the device. The frame is schematic, and the gray panel marks a future screenshot.</p></header><section>''' + "".join(cards) + '''</section><footer><strong>Direction:</strong> use this single-device landscape layout throughout the Duo set.<br>Apple lists portrait and landscape as accepted alternatives; its published requirements do not mandate both orientations.<p><a href="https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications">Apple screenshot specifications</a> · <a href="https://keiver.dev/lab/iphone-duo-app-store-screenshots">Tomo TV examples, Oct 15</a> · <a href="https://appscreens.com/template/app-store-screenshots/iphone-duo-calfo/YXGm5">AppScreens portrait example, updated Oct 23</a></p>Research checked October 24, 2026. Dimensions and RGB format are validated locally; this placeholder study is not a submission asset.</footer></main></html>''')
    print(f"Rendered {len(previews)} layout studies: {output / 'index.html'}")


if __name__ == "__main__":
    main()
