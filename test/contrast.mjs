import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync('dist/style.css','utf8');
function variables(selector){const result={};for(const match of css.matchAll(new RegExp(selector+'\\s*\\{([^}]+)\\}','g'))){for(const entry of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g))result[entry[1]]=entry[2].trim()}return result}
function luminance(hex){const s=hex.slice(1);const channels=(s.length===3?s.split('').map(c=>c+c).join(''):s).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722}
function ratio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
const light=variables(':root'),dark={...light,...variables('\\.dark')};
const pairs = [
 ['--button-text','--button-bg'], ['--control-text','--control-bg'], ['--muted','--soft'],
 ['--text','--surface'], ['--muted','--bg'], ['--tint-text','--tint'],
 ['--pdf-ink','--pdf-bg'], ['--word-ink','--word-bg'], ['--md-ink','--md-bg'],
 ['--excel-ink','--excel-bg'],
 ['--danger-text','--danger-bg']
];
for(const [theme,vars] of [['light',light],['dark',dark]]){
 for(const [foreground,background] of pairs)assert.ok(ratio(vars[foreground],vars[background])>=4.5,theme+': '+foreground+' on '+background);
}
for(const [file,vars] of [['brand.svg',light],['brand-dark.svg',dark]]){
 const wordmark=fs.readFileSync('dist/'+file,'utf8');
 assert.equal(wordmark.match(/<g fill="([^"]+)"/)[1],vars['--button-bg']);
}
console.log('PASS: the primary color matches the logo, and text, controls and format labels meet 4.5:1 contrast in both themes.');
