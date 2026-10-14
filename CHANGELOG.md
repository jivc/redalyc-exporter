# Changelog

## 1.0.0 (2026-10-14)

First public release.

- Export panel on Redalyc search results pages, with search string, applied filters and result count.
- Retrieval of complete result sets through paginated requests (100 records per request, short pause, up to three retries, cancellable).
- Output in RIS, BibTeX and CSV (UTF-8 with byte order mark), with title, authors, year and month, journal, volume, issue, pages, print and electronic ISSN, DOI, language, abstract, keywords and links to the article and PDF.
- Abstracts in all available languages (labelled [ES], [EN], [PT]) or in a preferred language; keywords merged without duplicates.
- Detection of filter boxes that were ticked but not applied.
- Removal and reporting of internal duplicates.
- Plain-text search log (date and time, search string, filters, counts, service address).
- Distributions: bookmarklet, Chromium and Firefox extensions (Manifest V3) and userscript.
