import * as pdfjs from './vendor/pdf.mjs';
import { ContinuousPdfReader } from './pdf-reader.js';
import { createReadingMode } from './reading-mode.js';
import { icon } from './icons.js';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = s => document.querySelector(s);
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[], mode='all', filter='all', db, current, pdf, pdfReader, zoom=1, openToken=0, pendingDelete, positionTimer, documentLoading=false;
let toastTimer;
const readingMode=createReadingMode({reader:$('#reader'),button:$('#readerFullscreen'),exitButton:$('#exitReadingFullscreen'),onError:message=>toast(message),onLayoutChange(){
 const viewer=pdfReader;const position=viewer?.getPosition();
 requestAnimationFrame(()=>{if(viewer&&viewer===pdfReader){viewer.resize();viewer.restorePosition(position);viewer.updateVisible();}});
}});
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500)}
async function initDB(){return new Promise((resolve,reject)=>{let req=indexedDB.open('hoja-library',1);req.onupgradeneeded=()=>req.result.createObjectStore('documents',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbOp(action,value){if(!db)throw new Error('storage');return new Promise((resolve,reject)=>{const tx=db.transaction('documents',action==='getAll'?'readonly':'readwrite');const store=tx.objectStore('documents');const req=store[action](...(value===undefined?[]:[value]));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function draw(){
 $('#navCount').textContent=records.length;$('#favoriteCount').textContent=records.filter(r=>r.favorite).length;
 const needle=$('#search').value.toLocaleLowerCase('es');
 const items=records.filter(r=>(mode!=='favorites'||r.favorite)&&(filter==='all'||(filter==='pdf'?r.ext==='pdf':r.ext!=='pdf'))&&r.name.toLocaleLowerCase('es').includes(needle)).sort((a,b)=>$('#sort').value==='name'?a.name.localeCompare(b.name,'es'):(b.opened||b.added)-(a.opened||a.added));
 $('#listTitle').textContent=mode==='favorites'?'Favoritos':'Documentos';
 $('#documentList').innerHTML=items.map(record=>`
   <div class="document-card">
     <button class="document-open" data-open="${record.id}" title="${escape(record.name)}">
       <span class="format-label ${record.ext==='pdf'?'pdf':'word'}">${record.ext.toUpperCase()}</span>
       <span class="document-info">
         <strong>${escape(record.name)}</strong>
         <small>${size(record.size)} · ${date(record.opened||record.added)}</small>
       </span>
     </button>
     <div class="card-actions">
       <button class="icon-button ${record.favorite?'is-favorite':''}" data-fav="${record.id}" aria-label="${record.favorite?'Quitar de':'Añadir a'} favoritos" aria-pressed="${!!record.favorite}">${icon('star')}</button>
       <button class="icon-button" data-delete="${record.id}" aria-label="Quitar ${escape(record.name)} de la biblioteca">${icon('trash')}</button>
     </div>
   </div>`).join('');
 $('#emptyState').hidden=items.length>0;
 const noRecords=!records.length&&mode==='all'&&filter==='all'&&!needle;
 $('#emptyState h3').textContent=noRecords?'Todavía no hay documentos':mode==='favorites'&&!needle?'Aún no hay favoritos':'No encontramos documentos';
 $('#emptyState p').textContent=noRecords?'Abre un PDF o Word para guardarlo en la biblioteca.':mode==='favorites'&&!needle?'Pulsa la estrella de un documento para tenerlo a mano.':'Prueba con otro nombre o cambia el filtro.';
 $('#examplesSection').hidden=mode==='favorites'||!!needle;
}
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const date=n=>new Intl.DateTimeFormat('es',{day:'numeric',month:'short'}).format(new Date(n));
async function importFiles(files){
 let first;
 for(const file of files){
 const ext=file.name.split('.').pop().toLowerCase();
 if(!['pdf','docx','doc'].includes(ext)){toast('Elige un documento PDF, DOCX o DOC.');continue}
 if(!file.size||file.size>50*1024*1024){toast(file.size?'El límite es de 50 MB por documento.':'Este documento está vacío.');continue}
 const existing=records.find(r=>r.name===file.name&&r.size===file.size&&(file.hojaFingerprint?r.fingerprint===file.hojaFingerprint:r.modified===file.lastModified));
 if(existing){first ||= existing;continue}
 const record={id:crypto.randomUUID(),name:file.name,ext,size:file.size,modified:file.lastModified,fingerprint:file.hojaFingerprint,added:Date.now(),favorite:false,page:1,blob:file};
 try{await dbOp('put',record)}catch{toast('No se pudo guardar en este navegador. Podrás leerlo durante esta sesión.');}
 records.push(record);first ||= record;
 }
 draw();if(first)await openDocument(first);$('#fileInput').value='';
}
async function openDocument(record){
 savePosition();
 const token=++openToken;
 pdfReader?.destroy();pdfReader=null;
 if(pdf){pdf.destroy();pdf=null}
 current=record;zoom=1;documentLoading=true;
 $('#reader').hidden=false;$('#app').inert=true;$('#app').hidden=true;document.body.style.overflow='hidden';$('#closeReader').focus();$('#readerName').textContent=record.name;
 $('#readerStatus').textContent=record.ext==='pdf'?'PDF · Solo lectura':record.ext==='doc'?'DOC · Solo lectura':'Word · Solo lectura';
 $('#pdfPages').hidden=true;$('#wordContent').hidden=true;$('#wordContent').replaceChildren();$('#readerLoading').hidden=false;$('#readerLoading').textContent='Abriendo tu documento…';updateZoomControls();$('#readerViewport').scrollTo(0,0);
 try{
 const bytes=await record.blob.arrayBuffer();if(token!==openToken)return;
 if(record.ext==='pdf'){
 const task=pdfjs.getDocument({data:bytes,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,isEvalSupported:false});
 task.onPassword=(update,reason)=>{if(token!==openToken){task.destroy();return}const password=prompt(reason===2?'Contraseña incorrecta. Inténtalo de nuevo:':'Este PDF está protegido. Introduce su contraseña:');if(password===null){task.destroy();toast('No se abrió el PDF protegido.');closeReader()}else update(password)};
 const loaded=await task.promise;if(token!==openToken){loaded.destroy();return}pdf=loaded;
 const viewer = new ContinuousPdfReader({pdfjs, container:$('#pdfPages'), viewport:$('#readerViewport'),
  onPositionChange(position,total){
   if(token!==openToken)return;
   $('#readerStatus').textContent=`Página ${position.page} de ${total}`;
   record.page=position.page;record.pageOffset=position.offset;
   clearTimeout(positionTimer);positionTimer=setTimeout(()=>{if(!record.sample)dbOp('put',record).catch(()=>{})},250);
  },
  onZoomChange(value){
   if(token!==openToken)return;
   zoom=value;
   updateZoomControls();
  },
  onError(){if(token===openToken)toast('No se pudo mostrar una de las páginas del PDF.');}
 });
 pdfReader=viewer;$('#readerLoading').hidden=true;$('#pdfPages').hidden=false;
 await viewer.open(loaded,{page:record.page||1,offset:record.pageOffset||0});
 }else{
 let html;
 if(record.ext==='docx'){const result=await mammoth.convertToHtml({arrayBuffer:bytes});html=DOMPurify.sanitize(result.value,{FORBID_TAGS:['style','script','iframe','form','object','embed','input','button'],FORBID_ATTR:['contenteditable']})}
 else{const text=await window.readLegacyDoc(bytes);if(!text.trim())throw new Error('empty');html=text.split(/\n+/).map(p=>`<p>${escape(p)}</p>`).join('')}
 if(token!==openToken)return;
 $('#wordContent').innerHTML=html||'<p>Este documento no contiene texto visible.</p>';$('#wordContent').style.fontSize='16px';$('#wordContent').hidden=false;
 $('#wordContent').querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});
 }
 if(token!==openToken)return;$('#readerLoading').hidden=true;documentLoading=false;updateZoomControls();
 record.opened=Date.now();if(!record.sample){try{await dbOp('put',record)}catch{}draw()}
 }catch(error){if(token!==openToken)return;$('#readerLoading').hidden=false;$('#readerLoading').textContent='No se pudo abrir este documento. Puede estar dañado, protegido o tener un formato no compatible. Vuelve a la biblioteca y prueba con otro archivo.';$('#pdfPages').hidden=true;$('#wordContent').hidden=true;console.error('Document read failed:',error.name)}
}
function savePosition(){
 clearTimeout(positionTimer);
 if(pdfReader&&current&&!current.sample){Object.assign(current,{page:pdfReader.getPosition().page,pageOffset:pdfReader.getPosition().offset});dbOp('put',current).catch(()=>{});}
}
function closeReader(){
 readingMode.exit();
 savePosition();openToken++;pdfReader?.destroy();pdfReader=null;if(pdf){pdf.destroy();pdf=null}
 $('#reader').hidden=true;$('#app').inert=false;$('#app').hidden=false;document.body.style.overflow='';$('#wordContent').replaceChildren();$('#openFile').focus();draw();
}
function updateZoomControls(){
 $('#zoomLabel').textContent=Math.round(zoom*100)+'%';$('#zoomOut').disabled=documentLoading||zoom<=.6;$('#zoomIn').disabled=documentLoading||zoom>=2.5;$('#fitWidth').disabled=documentLoading;
}
function changeZoom(delta){
 zoom=Math.max(.6,Math.min(2.5,Math.round((zoom+delta)*10)/10));updateZoomControls();
 if(pdfReader)pdfReader.setZoom(zoom);else $('#wordContent').style.fontSize=(16*zoom)+'px';
}
$('#openFile').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>importFiles(e.target.files);
for(const event of ['dragenter','dragover'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.add('dragover')});
for(const event of ['dragleave','drop'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragover');if(event==='drop')importFiles(e.dataTransfer.files)});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
function bindSelection(selector, activeClass, setSelection){
 const buttons=document.querySelectorAll(selector);
 for(const button of buttons)button.onclick=()=>{
  setSelection(button);
  for(const item of buttons){
   const selected=item===button;
   item.classList.toggle(activeClass,selected);
   item.setAttribute('aria-pressed',String(selected));
  }
  draw();
 };
}
bindSelection('[data-nav]','active',button=>{mode=button.dataset.nav});
bindSelection('[data-filter]','selected',button=>{filter=button.dataset.filter});
$('#search').oninput=draw;$('#sort').onchange=draw;
$('#documentList').onclick=async e=>{const open=e.target.closest('[data-open]');if(open)return openDocument(records.find(r=>r.id===open.dataset.open));const fav=e.target.closest('[data-fav]');if(fav){const r=records.find(r=>r.id===fav.dataset.fav);r.favorite=!r.favorite;try{await dbOp('put',r)}catch{toast('El cambio se conservará durante esta sesión.')}draw()}const del=e.target.closest('[data-delete]');if(del){pendingDelete=del.dataset.delete;$('#deleteName').textContent=records.find(r=>r.id===pendingDelete).name;$('#deleteDialog').showModal()}};
$('#cancelDelete').onclick=()=>$('#deleteDialog').close();$('#confirmDelete').onclick=async()=>{try{if(db)await dbOp('delete',pendingDelete);records=records.filter(r=>r.id!==pendingDelete);$('#deleteDialog').close();draw();toast('Documento quitado de la biblioteca.')}catch{toast('No se pudo quitar el documento. Inténtalo de nuevo.')}};
for(const b of document.querySelectorAll('[data-example]'))b.onclick=async()=>{const ext=b.dataset.example;try{const response=await fetch(`samples/ejemplo.${ext}`);if(!response.ok)throw new Error();openDocument({id:'sample-'+ext,ext,name:ext==='pdf'?'El placer de leer sin prisa.pdf':'Bienvenido a tu nuevo espacio.docx',blob:await response.blob(),sample:true})}catch{toast('No se pudo cargar el ejemplo. Comprueba tu conexión.')}};
$('#closeReader').onclick=closeReader;$('#zoomOut').onclick=()=>changeZoom(-.1);$('#zoomIn').onclick=()=>changeZoom(.1);$('#fitWidth').onclick=()=>{zoom=1;changeZoom(0)};
window.addEventListener('keydown',e=>{if($('#reader').hidden||e.defaultPrevented||$('dialog[open]'))return;if(e.key==='Escape')closeReader();if(e.key===' ' && e.target.closest?.('input, button, select, a'))return;if(['ArrowDown','ArrowUp','PageDown','PageUp',' '].includes(e.key)){e.preventDefault();const direction=['ArrowUp','PageUp'].includes(e.key)?-1:1;const amount=e.key.startsWith('Arrow')?60:$('#readerViewport').clientHeight*.85;$('#readerViewport').scrollBy({top:direction*amount,behavior:'auto'});}});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(pdfReader)pdfReader.resize()},200)});
$('#help').onclick=()=>$('#helpDialog').showModal();$('.dialog-close').onclick=()=>$('#helpDialog').close();$('.dialog-done').onclick=()=>$('#helpDialog').close();for(const d of document.querySelectorAll('dialog'))d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}};
try{db=await initDB();records=await dbOp('getAll')}catch{toast('El almacenamiento no está disponible. Podrás leer archivos durante esta sesión.')}draw();

// Android passes selected content URIs through a local, one-use HTTPS endpoint.
let androidImportQueue=Promise.resolve();
window.hojaOpenAndroidDocuments = documents => androidImportQueue=androidImportQueue.catch(()=>{}).then(async()=>{
 const files=[];
 for(const item of documents){
  try{
   const url=new URL(item.url,location.href);
   if(url.origin!==location.origin||!url.pathname.startsWith('/incoming/'))throw new Error('Invalid document origin');
   const response=await fetch(url);if(!response.ok)throw new Error('Document unavailable');
   const blob=await response.blob();
   if(blob.size>50*1024*1024){toast('El límite es de 50 MB por documento.');continue}
   const file=new File([blob],item.name,{type:item.type,lastModified:item.modified||Date.now()});
   if(crypto.subtle){const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());file.hojaFingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
   files.push(file);
  }catch{toast('No se pudo recibir el documento. Vuelve a abrirlo desde tu gestor de archivos.');}
 }
 if(files.length)await importFiles(files);
});
window.hojaReady=true;
