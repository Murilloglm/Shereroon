"""Measure the avatar opening in a display mask without changing raster artwork."""
from pathlib import Path
from statistics import median
from PIL import Image


def opening_center(path):
    with Image.open(path) as image:
        alpha = image.convert("RGBA").getchannel("A")
    w, h = alpha.size
    cx, cy = w // 2, h // 2
    if alpha.getpixel((cx, cy)) >= 50:
        return None  # An authored silhouette supplies the opening for this artwork.

    def midpoint(length, pixel):
        lo = hi = length // 2
        if pixel(lo) >= 50:
            return None
        while lo > 0 and pixel(lo - 1) < 50:
            lo -= 1
        while hi + 1 < length and pixel(hi + 1) < 50:
            hi += 1
        if lo == 0 or hi == length - 1:
            return None
        return 50 * (lo + hi + 1) / length

    xs = [midpoint(w, lambda x: alpha.getpixel((x, y))) for y in range(cy-h//12, cy+h//12+1)]
    ys = [midpoint(h, lambda y: alpha.getpixel((x, y))) for x in range(cx-w//12, cx+w//12+1)]
    xs, ys = [v for v in xs if v is not None], [v for v in ys if v is not None]
    return (round(median(xs), 2), round(median(ys), 2)) if xs and ys else None


def write_centers(root):
    rows = []
    for mask in sorted((root / "web/public/assets/cosmetic-masks").glob("*-avatar.png")):
        slug = mask.name.removesuffix("-avatar.png")
        center = opening_center(mask)
        if center:
            rows.append(f"  '{slug}': [{center[0]}, {center[1]}],")
    target = root / "shared/avatar-centers.ts"
    target.write_text("\n".join(["// Generated from the transparent avatar openings.",
        "export const avatarCenters: Record<string, [number, number]> = {", *rows, "};", ""]), encoding="utf8")


if __name__ == "__main__":
    write_centers(Path(__file__).resolve().parents[1])
