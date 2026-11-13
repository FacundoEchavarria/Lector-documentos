const {Buffer} = require('buffer');
const Extractor = require('word-extractor/lib/word-ole-extractor');
// Buffer's browser UTF-16 decoder preserves an odd trailing null byte.
// Normalize OLE directory names before resolving their streams.
const Tree = require('word-extractor/lib/ole-directory-tree');
const loadTree = Tree.prototype.load;
Tree.prototype.load = async function(ids) {
 await loadTree.call(this, ids);
 for (const entry of this._entries) entry.name = entry.name.replace(/\0+$/, '');
 this._buildHierarchy(this.root);
};
const Reader = require('word-extractor/lib/buffer-reader');
window.readLegacyDoc = async (bytes) => {
 const doc = await new Extractor().extract(new Reader(Buffer.from(bytes)));
 return [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter(Boolean).join('\n\n');
};
