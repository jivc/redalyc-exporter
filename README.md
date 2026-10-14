# Redalyc Exporter (Exportador Redalyc)

Redalyc Exporter adds the export function that the [Redalyc](https://www.redalyc.org) search interface lacks. It reads the search string and the filters applied on a Redalyc results page, retrieves every record through paginated requests to the same service used by the search interface, and writes **RIS**, **BibTeX** or **CSV** files ready for Zotero, Mendeley, EndNote, JabRef, Rayyan or Covidence. It also produces a plain-text **search log** that supports reporting literature searches according to PRISMA-S.

The tool was developed for systematic reviews that include Ibero-American literature published in Spanish and Portuguese.

*En español más abajo.*

## What each record contains

| Field | RIS | BibTeX | CSV |
|---|---|---|---|
| Title | TI | title | titulo |
| Authors | AU | author | autores |
| Year (month) | PY (DA) | year (month) | anio |
| Journal | T2, JF | journal | revista |
| Volume and issue | VL, IS | volume, number | volumen, numero |
| Pages | SP, EP | pages | paginas |
| Print and electronic ISSN | SN | issn | issn, eissn |
| DOI | DO | doi | doi |
| Language | LA | language | idioma |
| Abstract (all available languages or a preferred one) | AB | abstract | resumen |
| Keywords (all languages, without duplicates) | KW | keywords | palabras_clave |
| Links to the article and PDF | UR, L1 | url | url, pdf |

The search log records the date and time, the exact search string, the applied filters, the number of results reported by Redalyc, the number of records exported and the address of the service queried.

## Installation

Three distributions share the same code (`src/exportador.js`). Choose one.

### 1. Bookmarklet (recommended; any desktop browser)

Works in Firefox, Chrome, Edge, Brave and Safari, needs no extension and is kept like any other bookmark.

- Open the installation page, <https://juliovega.org/exportador_redalyc.html> (or `docs/index.html` in this repository), and drag the **Exportar Redalyc** button to the bookmarks bar. Show the bar with `Ctrl+Shift+B` (Windows, Linux) or `⌘+Shift+B` (macOS).
- Alternatively, create a new bookmark and paste the content of `bookmarklet/bookmarklet.txt` as its URL.

### 2. Browser extension

- **Chrome, Edge, Brave:** open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked* and select `extension/chrome`.
- **Firefox (128 or later):** open `about:debugging#/runtime/this-firefox` and load `extension/firefox/manifest.json` as a temporary add-on. Unsigned add-ons are removed when Firefox closes; for permanent use in Firefox, prefer the bookmarklet or the userscript.

### 3. Userscript

Install [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey and open `userscript/redalyc-exporter.user.js`.

## Usage

1. Run a search in Redalyc's article search and, if needed, apply filters (year, language, discipline, country).
2. Click the bookmark (or the **Exportar referencias** button added by the extension or userscript).
3. Choose the format, the scope (all results or the visible page) and the abstract language, then click **Exportar**. A search returning about 1,500 records takes roughly one minute.
4. Download the search log (.txt) and keep it with the review's search documentation.

The exporter follows the filters that have been **applied**, not boxes that have only been ticked, and warns when the two differ. Internal duplicates are removed and reported. The interface is in Spanish.

## How it works

The code runs entirely in the user's browser and has no external dependencies. It reads the state of the Redalyc search page (search string, applied filters, sort order), requests the records in batches of 100 with a short pause between requests and up to three retries, normalizes the fields and generates the file locally. No data are sent to any server other than Redalyc.

## Limitations

- It depends on an internal Redalyc search service that is not documented as a public interface; changes on Redalyc's side may break it until it is updated (see `serviceUrl` in `src/exportador.js`).
- Records are exported as stored in Redalyc, including errors at source (e.g., inverted author names or wrong language labels on abstracts). The only correction applied is an apostrophe stored by Redalyc as an inverted question mark.
- Redalyc's search service does not return cited references or the names of author institutions, so the output is suited to searching and screening, not to citation-based bibliometric analyses.
- Bookmarklets do not work well in mobile browsers; the tool is intended for desktop use.

## Building from source

`src/exportador.js` is the single source. After editing it, rebuild every distribution with:

```bash
python3 tools/build.py
```

Node.js (`npx`) is optional and is used to minify the bookmarklet with terser.

## Repository structure

```
src/exportador.js                core code (panel, retrieval, normalization, RIS/BibTeX/CSV writers)
src/bookmarklet_wrap.js          wrapper used to build the bookmarklet
bookmarklet/bookmarklet.txt      ready-to-use bookmarklet URL
extension/chrome/                Chromium extension (Manifest V3)
extension/firefox/               Firefox extension (Manifest V3)
userscript/                      Violentmonkey / Tampermonkey userscript
docs/index.html                  installation page with the draggable bookmarklet
examples/                        files exported in the illustrative example
tools/build.py                   rebuilds all distributions from src/
```

## Citation

If you use Redalyc Exporter in a review, please cite it (see `CITATION.cff`):

> Vega-Cauich, J. I. (2026). *Redalyc Exporter (Exportador Redalyc)* (Version 1.0.0) [Computer software]. https://doi.org/[Zenodo DOI]

## License

MIT. See `LICENSE`. Redalyc Exporter is an independent tool and is not affiliated with Redalyc or the Universidad Autónoma del Estado de México.

---

## En español

El Exportador Redalyc agrega a [Redalyc](https://www.redalyc.org) la opción de exportar que le falta. Lee la cadena de búsqueda y los filtros aplicados en la página de resultados, recupera todos los registros desde el mismo servicio que usa el buscador y genera archivos **RIS**, **BibTeX** o **CSV** con título, autores, revista, volumen, número, páginas, ISSN, DOI, idioma, resumen y palabras clave, además de un **registro de búsqueda** útil para documentar la estrategia según PRISMA-S.

**Instalación recomendada:** abre <https://juliovega.org/exportador_redalyc.html> y arrastra el botón **Exportar Redalyc** a tu barra de marcadores (`Ctrl+Shift+B` para mostrarla). Funciona en Firefox, Chrome, Edge, Brave y Safari de escritorio. También puedes usar la extensión (`extension/`) o el userscript (`userscript/`).

**Uso:** haz tu búsqueda en Redalyc, aplica los filtros que necesites, da clic en el marcador, elige el formato y pulsa **Exportar**. Al terminar puedes descargar el registro de búsqueda (.txt).

Autor: Julio Isaac Vega-Cauich, Facultad de Educación, Universidad Autónoma de Yucatán (ORCID [0000-0001-9190-3720](https://orcid.org/0000-0001-9190-3720)). Licencia MIT.
