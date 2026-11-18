# Hoja

Responsive Spanish read-only PDF and Word reader. Static application; documents are processed locally and persisted in IndexedDB. No document uploads or document editing endpoints.

PDF.js renders every PDF page in a continuous vertical column with selectable text, lazy rendering, bounded canvas memory, and retained scroll position when zooming. DOCX Preview renders Word pages in an isolated frame, retaining page dimensions, headers, footers, paragraph styles and tables. Additional pages are created when rendered content exceeds the page height. Legacy DOC uses a browserified OLE text extractor; its directory name normalization fixes the browser Buffer UTF-16 decoder's odd-byte behavior. Fonts, complex layouts and automatically calculated breaks can vary from Word.

`npm install` installs development dependencies. `npm run check` validates the app syntax and uses jsdom with fake-indexeddb to exercise document opening, search, favorites, storage, Android document delivery, and malformed input handling. Additional tests rasterize real PDF pages, exercise long-document lazy rendering and zoom, and verify control contrast in both themes. `npm run bundle:doc` rebuilds the legacy parser.

Deploy the contents of dist. `.openai/hosting.json` declares the Site identity and static directory. Dependencies are vendored in dist/vendor. No runtime npm build is needed.

Documents are per browser/device. Clearing browser data clears the library, leaving original files intact. The app requires connectivity to load and has no service worker/offline promise. Mobile browsers can add it to the home screen from their native menu.

Validation: PDF fixture parsed using PDF.js, DOCX fixtures rendered using DOCX Preview, real OLE DOC parsed using the browser bundle, and DOM interaction tests passed. Visual/browser QA was unavailable because this managed executor has no cua_repl tool. The Sites source helper was not installed; Git synchronization and static tar packaging were performed directly.

Android: see `android/README.md`. The latest signed APK is linked in `releases/README.md`. Version 1.1.0 adds Android VIEW/SEND document intents and preserves the 1.0.0 signing identity.

Version 1.1.1 fixes native CSS packaging when the Google Fonts import URL contains semicolons, adds a local Android fullscreen bridge with system-bar control, and verifies the stylesheet extracted from the signed APK. `node test/apk-style.mjs <apk>` checks the packaged colors and fullscreen rules.
