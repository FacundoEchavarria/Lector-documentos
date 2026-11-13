import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createCanvas,Path2D,DOMMatrix,ImageData} from '@napi-rs/canvas';
globalThis.Path2D=Path2D;globalThis.DOMMatrix=DOMMatrix;globalThis.ImageData=ImageData;
import * as pdfjs from '../dist/vendor/pdf.mjs';
import {ContinuousPdfReader} from '../dist/pdf-reader.js';
const dom=new JSDOM('<div id="viewport"><div id="pages"></div></div>',{pretendToBeVisual:true});
const w=dom.window, viewport=w.document.querySelector('#viewport'), container=w.document.querySelector('#pages');
let width=360;
Object.defineProperties(viewport,{clientWidth:{get:()=>width},clientHeight:{get:()=>640}});
Object.defineProperty(w.HTMLElement.prototype,'offsetTop',{get(){if(!this.classList.contains('pdf-page'))return 0;let top=0;for(let n=this.previousElementSibling;n;n=n.previousElementSibling)top+=(parseFloat(n.style.height)||0)+24;return top;}});
w.HTMLCanvasElement.prototype.getContext=function(){if(!this.backing)this.backing=createCanvas(this.width,this.height);return this.backing.getContext('2d')};
const textApi={TextLayer:class{constructor({textContentSource,container}){this.container=container;this.text=textContentSource}async render(){this.container.textContent=this.text.items.map(x=>x.str).join(' ')}cancel(){}}};
async function settle(reader){for(let n=0;n<400;n++){await new Promise(r=>setTimeout(r,5));if(!reader.active.size&&!reader.queue.length)return}throw Error('PDF rendering did not settle')}
const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync('dist/samples/ejemplo.pdf')),standardFontDataUrl:process.cwd()+'/dist/vendor/standard_fonts/'}).promise;
let latest,errors=[];
let reader=new ContinuousPdfReader({pdfjs:textApi,container,viewport,onPositionChange:p=>latest=p,onError:e=>{errors.push(e);console.error(e)}});
await reader.open(pdf);await settle(reader);
assert.equal(container.querySelectorAll('.pdf-page').length,2);
assert.equal(container.querySelectorAll('canvas').length,2);
assert.match(container.textContent,/placer de leer/);
assert.equal(latest.page,1);
viewport.scrollTop=reader.topOf(reader.pages[1])+100;reader.updateVisible();
const before=reader.getPosition();assert.equal(before.page,2);
reader.setZoom(1.5);await settle(reader);
assert.equal(reader.getPosition().page,2);assert.ok(Math.abs(reader.getPosition().offset-before.offset)<.001,'Zoom must preserve position within the page');
reader.setZoom(1.1);reader.setZoom(2);reader.setZoom(1);await settle(reader);
assert.equal(container.querySelectorAll('canvas').length,2);assert.equal(errors.length,0);
width=420;reader.resize();await settle(reader);assert.equal(reader.getPosition().page,2);
reader.destroy();assert.equal(container.children.length,0);await pdf.destroy();
console.log('PASS: real PDF rasterization, all pages in order, scroll position, zoom/resize retention, fast zoom cancellation.');

// A long document keeps all page frames while recycling off-screen canvases.
let requests=0,cancellations=0;
const longPdf={numPages:120,async getPage(number){requests++;return {
 getViewport({scale}){return {width:(number===80?842:595)*scale,height:(number===80?595:842)*scale,scale}},
 render(){let reject,timeout;const promise=new Promise((resolve,r)=>{reject=r;timeout=setTimeout(resolve,12)});return {promise,cancel(){cancellations++;clearTimeout(timeout);const e=new Error('cancelled');e.name='RenderingCancelledException';reject(e)}}},
 async getTextContent(){return {items:[{str:'Página '+number}]}},cleanup(){}
}}};
viewport.scrollTop=0;width=360;
reader=new ContinuousPdfReader({pdfjs:textApi,container,viewport,onPositionChange:p=>latest=p,onError:e=>{errors.push(e);console.error(e)}});
await reader.open(longPdf);await settle(reader);
assert.equal(container.children.length,120);assert.ok(requests<10);assert.ok(container.querySelectorAll('canvas').length<8);
const oldCanvas=reader.pages[0].canvas;
viewport.scrollTop=reader.topOf(reader.pages[79]);reader.updateVisible();await settle(reader);
assert.equal(latest.page,80);assert.equal(oldCanvas.width,0);assert.equal(container.children.length,120);assert.ok(container.querySelectorAll('canvas').length<10);assert.ok(requests<20);
const position=reader.getPosition();reader.setZoom(1.7);reader.setZoom(.8);await settle(reader);assert.equal(reader.getPosition().page,position.page);assert.equal(errors.length,0);
reader.setZoom(2.5);reader.destroy();await settle(reader);assert.equal(container.children.length,0);
console.log('PASS: 120 page frames, lazy rendering, mixed page sizes, canvas recycling and cancellation on close.');
dom.window.close();
