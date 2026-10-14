#!/usr/bin/env python3
"""Rebuild every distribution of Redalyc Exporter from src/exportador.js.

Outputs:
  bookmarklet/bookmarklet.txt          javascript: URL to save as a bookmark
  extension/chrome/exportador.js       Chromium extension (Manifest V3)
  extension/firefox/exportador.js      Firefox extension (Manifest V3, Firefox 128+)
  userscript/redalyc-exporter.user.js  Violentmonkey / Tampermonkey userscript
  dist/redalyc-exporter-chrome.zip     zipped Chromium extension
  dist/redalyc-exporter-firefox.xpi    unsigned Firefox package

Requirements: Python 3.8+. Node.js with npx is optional; when available, the
bookmarklet is minified with terser (smaller URL). Usage: python3 tools/build.py
"""
import json
import shutil
import subprocess
import tempfile
import urllib.parse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "exportador.js"
WRAP = ROOT / "src" / "bookmarklet_wrap.js"
VERSION = json.loads((ROOT / "extension" / "chrome" / "manifest.json").read_text(encoding="utf-8"))["version"]
DESC = ("Exporta los resultados de búsqueda de Redalyc a RIS, BibTeX o CSV, "
        "con resumen, palabras clave y DOI.")


def minify(code: str) -> str:
    """Minify with terser through npx if available; otherwise return the code unchanged."""
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "in.js", Path(tmp) / "out.js"
        src.write_text(code, encoding="utf-8")
        try:
            subprocess.run(["npx", "--yes", "terser@5", str(src), "-c", "-m", "--comments", "false", "-o", str(out)],
                           check=True, capture_output=True, timeout=180)
            return out.read_text(encoding="utf-8").strip()
        except (OSError, subprocess.SubprocessError):
            print("terser not available: the bookmarklet will be built without minification")
            return code


def build_bookmarklet(core: str) -> str:
    body = WRAP.read_text(encoding="utf-8").replace("/*CORE*/", core)
    # The outer function returns nothing, so Firefox does not replace the page with a return value.
    code = "(function(){" + minify(body) + "})();"
    url = "javascript:" + urllib.parse.quote(code, safe="-_.!~*'()")
    (ROOT / "bookmarklet" / "bookmarklet.txt").write_text(url, encoding="utf-8")
    return url


def build_userscript(core: str) -> None:
    header = "\n".join([
        "// ==UserScript==",
        "// @name         Redalyc Exporter",
        "// @namespace    https://juliovega.org",
        f"// @version      {VERSION}",
        f"// @description  {DESC}",
        "// @author       Julio Isaac Vega-Cauich",
        "// @license      MIT",
        "// @match        https://www.redalyc.org/busquedaArticulo*",
        "// @match        https://redalyc.org/busquedaArticulo*",
        "// @grant        none",
        "// @inject-into  page",
        "// @run-at       document-idle",
        "// ==/UserScript==",
        "",
    ])
    (ROOT / "userscript" / "redalyc-exporter.user.js").write_text(header + core, encoding="utf-8")


def build_extensions() -> None:
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    for kind in ("chrome", "firefox"):
        folder = ROOT / "extension" / kind
        shutil.copy(SRC, folder / "exportador.js")
        target = dist / ("redalyc-exporter-chrome.zip" if kind == "chrome" else "redalyc-exporter-firefox.xpi")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(folder.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(folder))


if __name__ == "__main__":
    core = SRC.read_text(encoding="utf-8")
    url = build_bookmarklet(core)
    build_userscript(core)
    build_extensions()
    print(f"Redalyc Exporter {VERSION}: bookmarklet ({len(url):,} characters), extensions and userscript rebuilt.")
