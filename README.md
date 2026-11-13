# Hoja

Responsive Spanish read-only PDF and Word reader. Static application; documents are processed locally and persisted in IndexedDB. No document uploads or document editing endpoints.

PDF.js renders PDFs with a selectable text layer and page navigation. Mammoth + DOMPurify provide a reflowing DOCX reading view. Legacy DOC uses a browserified OLE text extractor; its directory name normalization fixes the browser Buffer UTF-16 decoder's odd-byte behavior. Word layout is adapted rather than reproduced exactly.

`npm install` installs development dependencies. `npm run check` validates the app syntax and uses jsdom with fake-indexeddb to exercise document opening, search, favorites, storage, and malformed input handling. `npm run bundle:doc` rebuilds the legacy parser.

Deploy the contents of dist. `.openai/hosting.json` declares the Site identity and static directory. Dependencies are vendored in dist/vendor. No runtime npm build is needed.

Documents are per browser/device. Clearing browser data clears the library, leaving original files intact. The app requires connectivity to load and has no service worker/offline promise. Mobile browsers can add it to the home screen from their native menu.

Validation: PDF fixture parsed using PDF.js, DOCX fixture parsed using Mammoth, real OLE DOC parsed using the browser bundle, and DOM interaction tests passed. Visual/browser QA was unavailable because this managed executor has no cua_repl tool. The Sites source helper was not installed; Git synchronization and static tar packaging were performed directly.
