"""Génère dist/chrome.zip et dist/firefox.zip (manifest.json à la racine de chaque zip)."""
import zipfile, pathlib

ROOT = pathlib.Path(__file__).parent
FILES = ["background.js", "bid.js", "collection.js", "content.js", "sell.js", "popup.html", "popup.js"]
ICONS = sorted((ROOT / "icons").glob("icon*.png"))
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

for target, manifest in (("chrome", "manifest.json"), ("firefox", "manifest.firefox.json")):
    out = DIST / f"{target}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(ROOT / manifest, "manifest.json")
        for f in FILES:
            z.write(ROOT / f, f)
        for i in ICONS:
            z.write(i, f"icons/{i.name}")
    print(f"{out.name}: {out.stat().st_size // 1024} Ko")
