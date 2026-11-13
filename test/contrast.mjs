import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync('dist/style.css','utf8');
function variables(selector){const result={};for(const match of css.matchAll(new RegExp(selector+'\\s*\\{([^}]+)\\}','g'))){for(const entry of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g))result[entry[1]]=entry[2].trim()}return result}
function luminance(hex){const s=hex.slice(1);const channels=(s.length===3?s.split('').map(c=>c+c).join(''):s).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722}
function ratio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
const light=variables(':root'),dark={...light,...variables('\\.dark')};
for(const [theme,vars] of [['light',light],['dark',dark]]){
 for(const [foreground,background] of [['--button-text','--button-bg'],['--control-text','--control-bg'],['--muted','--soft']])assert.ok(ratio(vars[foreground],vars[background])>=4.5,theme+': '+foreground+' on '+background);
}
console.log('PASS: button labels, icon controls and disabled controls exceed 4.5:1 contrast in light and dark themes.');
