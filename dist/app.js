import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = s => document.querySelector(s);
const icon = id => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[], mode='all', filter='all', db, current, pdf, page=1, zoom=1, openToken=0, renderTask, renderQueue=Promise.resolve(), pendingDelete;
let toastTimer;
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500)}
async function initDB(){return new Promise((resolve,reject)=>{let req=indexedDB.open('hoja-library',1);req.onupgradeneeded=()=>req.result.createObjectStore('documents',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbOp(action,value){if(!db)throw new Error('storage');return new Promise((resolve,reject)=>{const tx=db.transaction('documents',action==='getAll'?'readonly':'readwrite');const store=tx.objectStore('documents');const req=store[action](...(value===undefined?[]:[value]));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
function draw(){
 $('#navCount').textContent=records.length;$('#favoriteCount').textContent=records.filter(r=>r.favorite).length;
 const needle=$('#search').value.toLocaleLowerCase('es');
 const items=records.filter(r=>(mode!=='favorites'||r.favorite)&&(filter==='all'||(filter==='pdf'?r.ext==='pdf':r.ext!=='pdf'))&&r.name.toLocaleLowerCase('es').includes(needle)).sort((a,b)=>$('#sort').value==='name'?a.name.localeCompare(b.name,'es'):(b.opened||b.added)-(a.opened||a.added));
 $('#docCount').textContent=items.length;$('#listTitle').firstChild.textContent=mode==='favorites'?'Favoritos ':'Mi biblioteca ';
 $('#breadcrumb').textContent=mode==='favorites'?'Favoritos':'Documentos';
 $('#listSubtitle').textContent=mode==='favorites'?'Las lecturas que quieres tener cerca.':'Tus lecturas, siempre a mano.';
 $('#documentList').innerHTML=items.map(r=>`<div class="document-card"><button class="document-open" data-open="${r.id}"><div class="document-top"><span class="sample-icon ${r.ext==='pdf'?'pdf':'word'}">${icon('file')}</span><small>${r.ext.toUpperCase()} · ${size(r.size)}</small></div><h3>${escape(r.name)}</h3><p>${r.opened?'Última lectura':'Añadido'} · ${date(r.opened||r.added)}</p></button><div class="card-actions"><button class="icon-button ${r.favorite?'is-favorite':''}" data-fav="${r.id}" aria-label="${r.favorite?'Quitar de':'Añadir a'} favoritos" aria-pressed="${!!r.favorite}">${icon('star')}</button><button class="icon-button" data-delete="${r.id}" aria-label="Quitar ${escape(r.name)} de la biblioteca">${icon('trash')}</button></div></div>`).join('');
 $('#emptyState').hidden=items.length>0;
 const noRecords=!records.length&&mode==='all'&&filter==='all'&&!needle;
 $('#emptyState h3').textContent=noRecords?'Tu próxima lectura empieza aquí':mode==='favorites'&&!needle?'Tus favoritos tendrán su lugar aquí':'No encontramos documentos';
 $('#emptyState p').textContent=noRecords?'Abre tu primer documento y lo encontrarás en este espacio.':mode==='favorites'&&!needle?'Pulsa la estrella de un documento para tenerlo a mano.':'Prueba con otro nombre o cambia el filtro.';
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
 const existing=records.find(r=>r.name===file.name&&r.size===file.size&&r.modified===file.lastModified);
 if(existing){first ||= existing;continue}
 const record={id:crypto.randomUUID(),name:file.name,ext,size:file.size,modified:file.lastModified,added:Date.now(),favorite:false,page:1,blob:file};
 try{await dbOp('put',record)}catch{toast('No se pudo guardar en este navegador. Podrás leerlo durante esta sesión.');}
 records.push(record);first ||= record;
 }
 draw();if(first)await openDocument(first);$('#fileInput').value='';
}
async function openDocument(record){
 const token=++openToken;current=record;zoom=1;page=record.page||1;
 if(pdf){pdf.destroy();pdf=null}if(renderTask){renderTask.cancel();renderTask=null}
 $('#reader').hidden=false;$('#app').inert=true;document.body.style.overflow='hidden';$('#closeReader').focus();$('#readerName').textContent=record.name;
 $('#readerType').textContent=record.ext==='pdf'?'PDF · Solo lectura':record.ext==='doc'?'DOC · Vista de texto · Solo lectura':'Word · Vista de lectura · Solo lectura';
 $('#pdfPage').hidden=true;$('#wordContent').hidden=true;$('#readerLoading').hidden=false;$('#readerLoading').textContent='Abriendo tu documento…';$('#pdfPager').hidden=record.ext!=='pdf';$('#wordView').hidden=record.ext==='pdf';$('#zoomLabel').textContent='100%';$('#readerViewport').scrollTo(0,0);
 try{
 const bytes=await record.blob.arrayBuffer();if(token!==openToken)return;
 if(record.ext==='pdf'){
 const task=pdfjs.getDocument({data:bytes,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,isEvalSupported:false});
 task.onPassword=(update,reason)=>{if(token!==openToken){task.destroy();return}const password=prompt(reason===2?'Contraseña incorrecta. Inténtalo de nuevo:':'Este PDF está protegido. Introduce su contraseña:');if(password===null){task.destroy();toast('No se abrió el PDF protegido.');closeReader()}else update(password)};
 const loaded=await task.promise;if(token!==openToken){loaded.destroy();return}pdf=loaded;page=Math.min(page,pdf.numPages);$('#pageNumber').max=pdf.numPages;$('#pageTotal').textContent=`/ ${pdf.numPages}`;$('#pdfPage').hidden=false;await requestPdfRender();
 }else{
 let html;
 if(record.ext==='docx'){const result=await mammoth.convertToHtml({arrayBuffer:bytes});html=DOMPurify.sanitize(result.value,{FORBID_TAGS:['style','script','iframe','form','object','embed','input','button'],FORBID_ATTR:['contenteditable']})}
 else{const text=await window.readLegacyDoc(bytes);if(!text.trim())throw new Error('empty');html=text.split(/\n+/).map(p=>`<p>${escape(p)}</p>`).join('')}
 if(token!==openToken)return;
 $('#wordContent').innerHTML=html||'<p>Este documento no contiene texto visible.</p>';$('#wordContent').style.fontSize='16px';$('#wordContent').hidden=false;
 $('#wordContent').querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});
 }
 if(token!==openToken)return;$('#readerLoading').hidden=true;
 record.opened=Date.now();if(!record.sample){try{await dbOp('put',record)}catch{}draw()}
 }catch(error){if(token!==openToken)return;$('#readerLoading').hidden=false;$('#readerLoading').textContent='No se pudo abrir este documento. Puede estar dañado, protegido o tener un formato no compatible. Vuelve a la biblioteca y prueba con otro archivo.';$('#pdfPage').hidden=true;$('#wordContent').hidden=true;console.error('Document read failed:',error.name)}
}
function requestPdfRender(){
 if(renderTask)renderTask.cancel();const token=openToken;const target=page;const scale=zoom;
 renderQueue=renderQueue.catch(()=>{}).then(()=>renderPdf(token,target,scale));return renderQueue;
}
async function renderPdf(token,target,magnification){
 if(!pdf||token!==openToken)return;const localPdf=pdf;const p=await localPdf.getPage(target);if(token!==openToken||target!==page||magnification!==zoom)return;
 const natural=p.getViewport({scale:1});const available=$('#readerViewport').clientWidth-32;const fit=Math.min(available/natural.width,1.35);const viewport=p.getViewport({scale:fit*magnification});const ratio=Math.min(window.devicePixelRatio||1,2);
 const canvas=$('#pdfCanvas');canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';$('#pdfPage').style.width=viewport.width+'px';$('#pdfPage').style.height=viewport.height+'px';$('#pdfPage').style.setProperty('--scale-factor',viewport.scale);$('#textLayer').replaceChildren();
 renderTask=p.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null});
 try{await renderTask.promise}catch(e){if(e.name==='RenderingCancelledException')return;throw e}finally{renderTask=null}
 if(token!==openToken||target!==page||magnification!==zoom)return;
 const text=await p.getTextContent();if(token!==openToken||target!==page||magnification!==zoom)return;
 const textLayer=new pdfjs.TextLayer({textContentSource:text,container:$('#textLayer'),viewport});await textLayer.render();
 $('#pageNumber').value=page;$('#prevPage').disabled=page<=1;$('#nextPage').disabled=page>=pdf.numPages;$('#zoomLabel').textContent=Math.round(zoom*100)+'%';
 if(current&&!current.sample){current.page=page;try{await dbOp('put',current)}catch{}}
}
function closeReader(){openToken++;if(renderTask)renderTask.cancel();if(pdf){pdf.destroy();pdf=null}$('#reader').hidden=true;$('#app').inert=false;document.body.style.overflow='';$('#wordContent').replaceChildren();$('#openFile').focus();if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});draw()}
async function gotoPage(n){if(!pdf)return;page=Math.max(1,Math.min(pdf.numPages,Number(n)||1));$('#pageNumber').value=page;$('#readerViewport').scrollTo(0,0);try{await requestPdfRender()}catch{toast('No se pudo mostrar esta página.')}}
async function changeZoom(delta){zoom=Math.max(.6,Math.min(2.5,Math.round((zoom+delta)*10)/10));$('#zoomLabel').textContent=Math.round(zoom*100)+'%';if(pdf){try{await requestPdfRender()}catch{toast('No se pudo ajustar la página.')}}else $('#wordContent').style.fontSize=(16*zoom)+'px'}
$('#openFile').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>importFiles(e.target.files);
for(const event of ['dragenter','dragover'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.add('dragover')});
for(const event of ['dragleave','drop'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragover');if(event==='drop')importFiles(e.dataTransfer.files)});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
for(const b of document.querySelectorAll('[data-nav]'))b.onclick=()=>{mode=b.dataset.nav;document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el===b));draw()};
for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(el=>el.classList.toggle('selected',el===b));draw()};
$('#search').oninput=draw;$('#sort').onchange=draw;
$('#documentList').onclick=async e=>{const open=e.target.closest('[data-open]');if(open)return openDocument(records.find(r=>r.id===open.dataset.open));const fav=e.target.closest('[data-fav]');if(fav){const r=records.find(r=>r.id===fav.dataset.fav);r.favorite=!r.favorite;try{await dbOp('put',r)}catch{toast('El cambio se conservará durante esta sesión.')}draw()}const del=e.target.closest('[data-delete]');if(del){pendingDelete=del.dataset.delete;$('#deleteName').textContent=records.find(r=>r.id===pendingDelete).name;$('#deleteDialog').showModal()}};
$('#cancelDelete').onclick=()=>$('#deleteDialog').close();$('#confirmDelete').onclick=async()=>{try{if(db)await dbOp('delete',pendingDelete);records=records.filter(r=>r.id!==pendingDelete);$('#deleteDialog').close();draw();toast('Documento quitado de la biblioteca.')}catch{toast('No se pudo quitar el documento. Inténtalo de nuevo.')}};
for(const b of document.querySelectorAll('[data-example]'))b.onclick=async()=>{const ext=b.dataset.example;try{const response=await fetch(`samples/ejemplo.${ext}`);if(!response.ok)throw new Error();openDocument({id:'sample-'+ext,ext,name:ext==='pdf'?'El placer de leer sin prisa.pdf':'Bienvenido a tu nuevo espacio.docx',blob:await response.blob(),sample:true})}catch{toast('No se pudo cargar el ejemplo. Comprueba tu conexión.')}};
$('#closeReader').onclick=closeReader;$('#prevPage').onclick=()=>gotoPage(page-1);$('#nextPage').onclick=()=>gotoPage(page+1);$('#pageNumber').onchange=e=>gotoPage(e.target.value);$('#zoomOut').onclick=()=>changeZoom(-.1);$('#zoomIn').onclick=()=>changeZoom(.1);$('#fitWidth').onclick=()=>{zoom=1;changeZoom(0)};
$('#readerFullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else if($('#reader').requestFullscreen)$('#reader').requestFullscreen().catch(()=>toast('La vista de lectura ya ocupa la pantalla disponible.'));else toast('La vista de lectura ya ocupa la pantalla disponible.')};
window.addEventListener('keydown',e=>{if($('#reader').hidden)return;if(e.key==='Escape')closeReader();if(e.target.matches('input'))return;if(e.key==='ArrowRight')gotoPage(page+1);if(e.key==='ArrowLeft')gotoPage(page-1)});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(pdf)requestPdfRender().catch(()=>{})},200)});
$('#help').onclick=()=>$('#helpDialog').showModal();$('#helpMobile').onclick=()=>$('#helpDialog').showModal();$('.dialog-close').onclick=()=>$('#helpDialog').close();$('.dialog-done').onclick=()=>$('#helpDialog').close();for(const d of document.querySelectorAll('dialog'))d.onclick=e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}};
try{document.body.classList.toggle('dark',localStorage.getItem('hoja-theme')==='dark')}catch{}
$('#theme').onclick=()=>{document.body.classList.toggle('dark');try{localStorage.setItem('hoja-theme',document.body.classList.contains('dark')?'dark':'light')}catch{}};
try{db=await initDB();records=await dbOp('getAll')}catch{toast('El almacenamiento no está disponible. Podrás leer archivos durante esta sesión.')}draw();
