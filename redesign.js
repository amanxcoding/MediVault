// Interactive liquid-glass menus and camera-assisted local document intake.
const uploadSession = { pages: [], camera: null, cameraStream: null, priorStep: 'upload', who: members[0].name, category: 'Report' };
const menuNodes = new Set();
const humanBytes = n => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
const makeIcon = (glyph, label='') => `<span class="option-icon" aria-hidden="true">${glyph}</span>${label}`;

dashboard=function(){
  const familyCards=members.map((m,i)=>`<button class="family-profile" type="button" data-member="${m.id}"><span class="avatar ${m.tone}">${esc(m.initials)}</span><span class="family-profile-copy"><strong>${esc(m.name)}</strong><small>${esc(m.relation)}</small></span><span class="family-profile-data"><strong>${m.docs} records</strong><small>${esc(m.last)}</small></span><span class="profile-arrow" aria-hidden="true">↗</span></button>`).join('');
  const recent=docs.slice(0,3).map((d,i)=>`<button class="care-record" type="button" data-doc="${esc(d.title)}"><span class="record-icon ${d.tone}">${d.icon}</span><span class="record-copy"><strong>${esc(d.title)}</strong><small>${esc(d.who)} <i>·</i> ${esc(d.date)}</small></span>${statusBadge(d.status)}<span class="record-chevron" aria-hidden="true">›</span></button>`).join('');
  return `<div class="dashboard-intro"><div><div class="eyebrow">YOUR FAMILY HEALTH SPACE <span class="live-mark"></span></div><h1 class="editorial-title">Your family’s health,<br><span>beautifully organized.</span></h1><p class="editorial-subtitle">Everything important, in one calm and connected place.</p></div><button class="btn btn-primary btn-lg" data-action="upload"><span class="icon-inline">＋</span>Add record</button></div>
  <section class="editorial-hero"><div class="hero-main"><div class="eyebrow">A CALMER WAY TO CARE</div><h2>Good care starts with<br>being able to find it.</h2><p>Your family’s records, reminders and care notes together in one private space.</p><button class="btn btn-glass" data-action="upload">Add a health record <span aria-hidden="true">↗</span></button></div><div class="hero-reflection" aria-hidden="true"><div class="reflection-glass"><span class="reflection-cross">✳</span><span class="reflection-copy"><strong>Care, connected</strong><small>One family · one shared story</small></span><span class="reflection-spark">✦</span></div><div class="reflection-orbit"></div></div><div class="hero-caption"><span>FAMILY HEALTH VAULT</span><span>PRIVATE BY DESIGN · DEMO DATA</span></div></section>
  <section class="summary-line" aria-label="Family vault summary"><div><span class="summary-label">Your care circle</span><strong>${String(members.length).padStart(2,'0')}</strong><small>family members</small></div><i></i><div><span class="summary-label">Records together</span><strong>${docs.length}</strong><small>in your vault</small></div><i></i><div><span class="summary-label">Next reminder</span><strong>1:00 <em>PM</em></strong><small>Omega-3 · Alex</small></div><button class="text-link" data-view="vault">Explore your vault <span>→</span></button></section>
  <section class="editorial-columns"><div class="editorial-main"><section class="family-section"><div class="section-heading"><div><div class="eyebrow">THE PEOPLE YOU CARE FOR</div><h2>Your family</h2><p>Every profile has its own health story.</p></div><button class="btn btn-ghost" data-view="family">View all <span>→</span></button></div><div class="family-list">${familyCards}</div></section>
  <section class="health-section"><div class="section-heading"><div><div class="eyebrow">YOUR RECORDS, AT A GLANCE</div><h2>Vault completeness</h2><p>Organization progress, not a medical health score.</p></div><span class="completion-pill"><span></span>Growing steadily</span></div><div class="health-summary"><div class="completion-ring"><div><strong>76<span>%</span></strong><small>organized</small></div></div><div class="health-summary-copy"><strong>A thoughtful start.</strong><p>Your family’s collection is taking shape. Add records as you go to make important details easier to find.</p><button class="btn btn-outline btn-sm" data-view="vault">See what’s here <span>→</span></button></div><div class="measure-snapshot"><div><span>Blood pressure</span><strong>118/76 <small>mmHg</small></strong><i>Recorded Jun 12</i></div><div><span>Resting heart rate</span><strong>68 <small>bpm</small></strong><i>Recorded Jun 12</i></div></div></div></section>
  <section class="records-section"><div class="section-heading"><div><div class="eyebrow">RECENTLY ADDED</div><h2>Latest in your vault</h2></div><button class="btn btn-ghost" data-view="vault">All records <span>→</span></button></div><div class="care-record-list">${recent}</div><div class="activity-inline"><span class="activity-stem"></span><span class="activity-icon">◷</span><span><strong>Ellie’s vaccination record</strong><small>Added by Alex · Jun 02, 2025</small></span><span class="activity-time">12 days ago</span><button class="text-link" data-view="timeline" aria-label="Open health timeline">↗</button></div></section></div>
  <aside class="editorial-rail"><section class="reminder-panel"><div class="eyebrow">SATURDAY · JUNE 14</div><div class="section-heading"><div><h2>A gentle nudge</h2><p>Today’s reminders</p></div><span class="reminder-mark">◷</span></div><div class="reminder-list">${meds.slice(0,3).map((m,i)=>`<div class="reminder-row"><span class="reminder-status ${m.done?'is-done':''}">${m.done?'✓':'·'}</span><span class="reminder-info"><strong>${esc(m.name)}</strong><small>${esc(m.detail)}</small></span><span class="reminder-time">${esc(m.time)}</span><button class="taken-button ${m.done?'done':''}" data-med="${i}" aria-label="${m.done?'Mark as upcoming':'Mark as taken'}">${m.done?'✓':'○'}</button></div>`).join('')}</div><button class="btn btn-secondary btn-full" data-view="medications">Manage reminders <span>→</span></button><p class="demo-note">Demo reminders · Follow your clinician’s instructions.</p></section><section class="privacy-card"><span class="privacy-sigil">⌑</span><div class="eyebrow">PRIVATE, ALWAYS</div><p>Your family’s details stay in your hands. You decide what to share.</p><button class="btn btn-ghost" data-view="settings">Privacy settings <span>↗</span></button></section></aside></section>`;
};

function stopCamera(){
  if(uploadSession.cameraStream){uploadSession.cameraStream.getTracks().forEach(track=>track.stop());uploadSession.cameraStream=null;}
  uploadSession.camera=null;
}
function revokePages(){uploadSession.pages.forEach(page=>{if(page.url)URL.revokeObjectURL(page.url)});uploadSession.pages=[];}
function showUpload(){
  stopCamera();revokePages();uploadSession.priorStep='upload';
  openModal(`<div class="eyebrow">YOUR FAMILY VAULT</div><h2>Add a medical record</h2><p class="modal-description">Capture a document or upload an existing file to add it to your family's medical vault.</p><div class="vault-upload-actions"><button class="upload-option" type="button" data-camera-start>${makeIcon('▣')}<strong>Take Photo</strong><small>Use your device camera</small></button><button class="upload-option" type="button" data-open-files>${makeIcon('⇧')}<strong>Upload Files</strong><small>Choose images or documents</small></button><button class="upload-option" type="button" data-scan-more disabled>${makeIcon('▤')}<strong>Scan Another Page</strong><small>Available after your first capture</small></button></div><div class="upload-drop" id="dropZone"><span class="option-icon" aria-hidden="true">↧</span><div><strong>Drop files here or choose files</strong><p>PDF, JPG, PNG, HEIC · Up to 10 MB per file · Multiple pages supported</p></div><input id="multiFiles" type="file" accept="image/*,.pdf" multiple aria-label="Choose medical record files"></div><div class="upload-meta"><div class="field"><label for="uploadWho">Family member</label><select id="uploadWho">${members.map(m=>`<option>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label for="uploadCategory">Document category</label><select id="uploadCategory"><option>Report</option><option>Prescription</option><option>Lab report</option><option>Vaccination</option><option>Visit summary</option><option>Medical bill</option></select></div></div><p class="camera-help" style="margin-bottom:0">Camera access is available on HTTPS or localhost. Files stay in this browser session only.</p><div class="modal-actions"><button class="btn" type="button" data-dismiss>Cancel</button></div>`);
  document.getElementById('multiFiles').addEventListener('change',e=>acceptFiles([...e.target.files]));
  document.getElementById('uploadWho').value=uploadSession.who;
  document.getElementById('uploadCategory').value=uploadSession.category;
  document.getElementById('uploadWho').addEventListener('change',e=>uploadSession.who=e.target.value);
  document.getElementById('uploadCategory').addEventListener('change',e=>uploadSession.category=e.target.value);
  const drop=document.getElementById('dropZone');
  ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragging')}));
  ['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragging')}));
  drop.addEventListener('drop',e=>acceptFiles([...e.dataTransfer.files]));
}
function acceptFiles(files){
  if(!files.length)return;
  const good=[];
  for(const file of files){
    if(file.size>10*1024*1024){notify(`${file.name} is over the 10 MB limit.`);continue;}
    if(!(file.type.startsWith('image/')||file.type==='application/pdf')){notify(`${file.name} is not a supported image or PDF.`);continue;}
    good.push({file,url:file.type.startsWith('image/')?URL.createObjectURL(file):'',name:file.name});
  }
  if(!good.length)return;
  uploadSession.pages.push(...good);showReview();
}
async function startCamera(){
  stopCamera();
  if(!navigator.mediaDevices?.getUserMedia){showCameraFallback('Live camera is not available here. Use the device camera picker instead.');return;}
  openCameraScreen();
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
    uploadSession.cameraStream=stream;
    const video=document.getElementById('cameraVideo');
    if(!video){stopCamera();return;}
    video.srcObject=stream;await video.play();
    document.getElementById('cameraStatus').textContent='Camera ready · Your image stays in this session.';
  }catch(err){
    stopCamera();
    const reason=err?.name==='NotAllowedError'?'Camera permission was not granted.':err?.name==='NotFoundError'?'No camera was found on this device.':'Camera could not be opened.';
    showCameraFallback(reason);
  }
}
function openCameraScreen(){
  uploadSession.priorStep='camera';
  openModal(`<div class="eyebrow">DOCUMENT CAPTURE</div><h2>Take a photo</h2><p class="modal-description">Frame one page at a time. You can add more pages before saving the record.</p><div class="camera-frame"><video id="cameraVideo" autoplay playsinline muted aria-label="Live camera preview"></video><div class="camera-placeholder" id="cameraPlaceholder"><div style="font-size:30px">▣</div><strong style="display:block;margin-top:8px;font-size:11px">Starting your camera…</strong></div></div><div class="camera-actions"><button class="btn" type="button" data-camera-cancel>Back</button><button class="capture-button" id="capturePhoto" type="button" aria-label="Capture photo" title="Capture photo"></button><button class="btn" type="button" data-camera-fallback>Use device picker</button></div><p class="camera-help" id="cameraStatus" style="text-align:center">Requesting camera access. HTTPS or localhost may be required.</p><input type="file" id="captureFallback" accept="image/*" capture="environment" hidden>`);
  const video=document.getElementById('cameraVideo');
  video.addEventListener('loadeddata',()=>document.getElementById('cameraPlaceholder')?.remove(),{once:true});
  document.getElementById('captureFallback').addEventListener('change',e=>acceptFiles([...e.target.files]));
}
function showCameraFallback(reason){
  stopCamera();
  const body=document.getElementById('modalContent');
  if(!body)return;
  body.innerHTML=`<div class="eyebrow">DOCUMENT CAPTURE</div><h2>Use your device camera</h2><p class="modal-description">${esc(reason)} You can use the built-in camera picker or select a photo you already took.</p><div class="dropzone"><div class="dropzone-icon">▣</div><strong>Camera access needs HTTPS or localhost</strong><p>Your browser may also ask you to allow camera access.</p></div><div class="field"><label for="fallbackPhoto">Take a photo or choose an image</label><input id="fallbackPhoto" type="file" accept="image/*" capture="environment"></div><div class="modal-actions"><button class="btn" type="button" data-camera-cancel>Back to upload options</button></div>`;
  document.getElementById('fallbackPhoto').addEventListener('change',e=>acceptFiles([...e.target.files]));
}
function captureFrame(){
  const video=document.getElementById('cameraVideo');
  if(!video||!video.videoWidth){notify('Wait for the camera preview, then try again.');return;}
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  canvas.toBlob(blob=>{if(!blob){notify('Could not capture that frame.');return;}const file=new File([blob],`family-record-page-${Date.now()}.jpg`,{type:'image/jpeg'});uploadSession.pages.push({file,url:URL.createObjectURL(blob),name:file.name});stopCamera();showCapturedPage();},'image/jpeg',.92);
}
function showCapturedPage(){
  openModal(`<div class="eyebrow">PAGE ${uploadSession.pages.length} CAPTURED</div><h2>Review this page</h2><p class="modal-description">Check the image is clear and readable. It has not been analyzed or sent anywhere.</p><img class="captured-preview" src="${uploadSession.pages.at(-1).url}" alt="Captured medical document page preview">${thumbs()}<div class="camera-actions"><button class="btn" type="button" data-retake>Retake</button><button class="btn" type="button" data-camera-start>Scan Another Page</button><button class="btn btn-primary" type="button" data-review-pages>Use Photo</button></div>`);
}
function thumbs(){return `<div class="page-thumbs" aria-label="Selected pages">${uploadSession.pages.map((p,i)=>`<div class="page-thumb" title="${esc(p.name)}">${p.url?`<img src="${p.url}" alt="Page ${i+1} thumbnail">`:`<span class="pdf-thumb">PDF</span>`}<button type="button" data-remove-page="${i}" aria-label="Remove page ${i+1}">×</button></div>`).join('')}</div>`}
function showReview(){
  stopCamera();
  const title=uploadSession.pages[0]?.name?.replace(/\.[^.]+$/,'')||'Medical record';
  openModal(`<div class="eyebrow">READY FOR REVIEW</div><h2>Review your record</h2><p class="modal-description">${uploadSession.pages.length} page${uploadSession.pages.length===1?'':'s'} selected. Demo processing only; no OCR or medical AI is running.</p>${thumbs()}${uploadSession.pages[0]?.url?`<img class="captured-preview" src="${uploadSession.pages[0].url}" alt="Selected document preview">`:`<div class="dropzone"><strong>${esc(uploadSession.pages[0]?.name||'Document selected')}</strong><p>PDF preview is not available in this demo.</p></div>`}<div class="upload-meta"><div class="field"><label for="reviewTitle">Record title</label><input id="reviewTitle" value="${esc(title)}" required></div><div class="field"><label for="reviewWho">Family member</label><select id="reviewWho">${members.map(m=>`<option ${m.name===uploadSession.who?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label for="reviewCategory">Category</label><select id="reviewCategory">${['Report','Prescription','Lab report','Vaccination','Visit summary','Medical bill'].map(c=>`<option ${c===uploadSession.category?'selected':''}>${c}</option>`).join('')}</select></div><div class="field"><label>Review status</label><span class="status status-pending">Ready for review · Demo</span></div></div><div class="upload-progress"><span></span></div><div class="camera-actions" style="justify-content:space-between"><button class="btn" type="button" data-upload-back>Back to upload</button><button class="btn" type="button" data-camera-start>＋ Add another page</button><button class="btn btn-primary" type="button" data-finalize> Add to Vault</button></div>`);
}
function finishRecord(){
  const title=document.getElementById('reviewTitle')?.value.trim();
  if(!title){document.getElementById('reviewTitle')?.focus();notify('Add a title for this record first.');return;}
  const who=document.getElementById('reviewWho').value,category=document.getElementById('reviewCategory').value;
  const first=uploadSession.pages[0];
  const icon=category==='Prescription'?'✳':category==='Lab report'?'⌁':category==='Vaccination'?'＋':'▤';
  const familyMember=members.find(m=>m.name===who);if(familyMember){familyMember.docs+=1;familyMember.last=`${category} · Today`;}
  docs.unshift({title,type:category,who,date:'Today',status:'Needs review',icon,tone:category==='Lab report'?'labs':category==='Vaccination'?'vaccine':'',source:first?.name||'',pages:uploadSession.pages.map(p=>p.url).filter(Boolean)});
  stopCamera();uploadSession.pages=[];closeModal();render(activeView==='landing'?'vault':activeView);notify('Record added to your local vault · Ready for your review.');
}
const menuIconSvg=(glyph)=>{const paths={'◉':'<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>','⚙':'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1L11 7.4h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1Z"/>','↗':'<path d="M7 17 17 7M8 7h9v9"/>','✳':'<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4"/>','▤':'<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h7m-7 4h7"/>','✓':'<path d="m5 12 4 4L19 6"/>'};return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[glyph]||'<path d="M12 5v14M5 12h14"/>'}</svg>`};
function createMenu(anchor,caption,items){
  closeMenus();const box=document.createElement('div');box.className='menu-popover';box.setAttribute('role','menu');box.setAttribute('aria-label',caption);box.innerHTML=`<div class="menu-caption">${caption}</div>${items.map((it,i)=>it.separator?'<div class="menu-separator"></div>':`<button type="button" role="menuitem" data-menu-action="${it.action}" ${i===0?'tabindex="0"':'tabindex="-1"'}><span class="menu-icon">${menuIconSvg(it.icon||'')}</span><span class="menu-label">${it.label}</span>${it.hint?`<span class="menu-hint">${it.hint}</span>`:''}</button>`).join('')}`;
  document.body.append(box);menuNodes.add(box);const r=anchor.getBoundingClientRect(),w=box.offsetWidth,h=box.offsetHeight;box.style.top=`${Math.min(r.bottom+8,innerHeight-h-10)}px`;box.style.left=`${Math.max(10,Math.min(r.right-w,innerWidth-w-10))}px`;anchor.setAttribute('aria-expanded','true');box._anchor=anchor;box.querySelector('[role=menuitem]')?.focus();
}
function closeMenus(restoreFocus=false){let anchor=null;menuNodes.forEach(n=>{anchor=n._anchor||anchor;n._anchor?.setAttribute('aria-expanded','false');n.remove()});menuNodes.clear();if(restoreFocus&&anchor?.isConnected)anchor.focus()}
function openProfileMenu(anchor){createMenu(anchor,'YOUR ACCOUNT',[{icon:'◉',label:'View profile',action:'profile'},{icon:'⚙',label:'Settings',action:'settings'},{separator:true},{icon:'↗',label:'Public website',action:'landing'}]);}
function openNotificationMenu(anchor){createMenu(anchor,'NOTIFICATIONS',[{icon:'✳',label:'Medication reminder',hint:'1:00 PM',action:'medications'},{icon:'▤',label:'Record needs review',hint:'New',action:'vault'},{icon:'✓',label:'You’re all caught up',action:'dismiss'}]);}
function showSearchMenu(input){
  closeMenus();const q=input.value.trim().toLowerCase();if(!q)return;
  const matches=docs.filter(d=>`${d.title} ${d.who} ${d.type}`.toLowerCase().includes(q)).slice(0,5);
  const people=members.filter(m=>`${m.name} ${m.relation}`.toLowerCase().includes(q)).slice(0,3);
  const box=document.createElement('div');box.className='menu-popover search-popover';box.setAttribute('role','listbox');box.innerHTML=`<div class="menu-caption">${q?'SEARCH RESULTS':'QUICK SEARCH'}</div>${matches.map(d=>`<button type="button" role="option" data-search-doc="${esc(d.title)}"><span>▤</span><span>${esc(d.title)}<small>${esc(d.who)} · ${esc(d.type)}</small></span></button>`).join('')}${people.map(m=>`<button type="button" role="option" data-search-person="${m.id}"><span>♧</span><span>${esc(m.name)}<small>${esc(m.relation)}</small></span></button>`).join('')}${!matches.length&&!people.length?'<div class="empty-state" style="padding:15px">No matching records or people.</div>':''}<button type="button" role="option" data-search-all="true"><span>⌕</span>View all records</button>`;
  document.body.append(box);menuNodes.add(box);const r=input.getBoundingClientRect(),w=Math.min(350,innerWidth-20);box.style.width=`${w}px`;box.style.top=`${Math.min(r.bottom+8,innerHeight-box.offsetHeight-10)}px`;box.style.left=`${Math.max(10,Math.min(r.left,innerWidth-w-10))}px`;box._anchor=input;box.querySelector('button')?.setAttribute('tabindex','0');
}
function syncDashboard(){
  document.querySelectorAll('.sidebar .nav-count')[0]?.replaceChildren(document.createTextNode(String(members.length)));
  document.querySelectorAll('.sidebar .nav-count')[1]?.replaceChildren(document.createTextNode(String(docs.length)));
  if(activeView!=='overview')return;
  const metrics=document.querySelectorAll('.stats-grid .stat-value');if(metrics[1])metrics[1].textContent=String(docs.length);
  const panel=document.querySelector('.health-panel');
  if(panel){const title=panel.querySelector('.card-head h3');if(title)title.textContent='Vault completeness';const sub=panel.querySelector('.card-head p');if(sub)sub.textContent='How much of your family’s record collection is organized';const note=panel.querySelector('.health-copy p');if(note)note.textContent='Completeness reflects records added to the vault. It is not a health score or medical assessment.';const headline=panel.querySelector('.health-copy strong');if(headline)headline.textContent='Records are coming together';}
}
const baseRender=render;
render=function(view=activeView){baseRender(view);syncDashboard();};
syncDashboard();

const baseVaultFilter=filterVault;
filterVault=function(){
  baseVaultFilter();
  const range=document.getElementById('dateFilter')?.value||'all';
  if(range==='all')return;
  const cards=[...document.querySelectorAll('#vaultGrid [data-doc]')];
  const cutoff=range==='2025'?new Date('2025-01-01'):new Date('2025-05-01');
  let visible=0;
  cards.forEach(card=>{const item=docs.find(d=>d.title===card.dataset.doc);const d=item?new Date(item.date):new Date('invalid');const show=d>=cutoff&&d<new Date('2026-01-01');card.hidden=!show;if(show)visible++});
  const count=document.getElementById('recordCount');if(count)count.textContent=String(visible);
};
const coreRender=render;
render=function(view=activeView){coreRender(view);if(view==='vault'){const toolbar=document.querySelector('.page-toolbar');const person=document.getElementById('personFilter');if(toolbar&&person&&!document.getElementById('dateFilter')){const f=document.createElement('select');f.className='filter-select';f.id='dateFilter';f.setAttribute('aria-label','Filter by date');f.innerHTML='<option value="all">Any date</option><option value="2025">2025</option><option value="recent">May 2025 onward</option>';toolbar.insertBefore(f,document.getElementById('sortButton'));f.addEventListener('change',filterVault)}}syncDashboard();};
document.addEventListener('change',e=>{if(e.target.id==='reducedMotion'){document.documentElement.classList.toggle('user-reduced-motion',e.target.checked);notify(e.target.checked?'Reduced motion preference saved.':'Motion preference saved.')}});

function showDocumentDetail(doc){
  closeMenus();
  const images=(doc.pages||[]).filter(Boolean);
  openModal(`<div class="eyebrow">${esc((doc.type||'RECORD').toUpperCase())} · ${esc((doc.date||'').toUpperCase())}</div><h2>${esc(doc.title)}</h2><p class="modal-description">${esc(doc.who)} · ${esc(doc.source||'Added in this session')} · ${images.length||1} page${(images.length||1)===1?'':'s'}</p>${images.length?`<img class="captured-preview" src="${images[0]}" alt="Preview of ${esc(doc.title)}">`:`<div class="dropzone"><div class="dropzone-icon">▤</div><strong>No document preview is available</strong><p>Original mock record · Illustrative metadata only</p></div>`}<div class="page-thumbs">${images.map((src,i)=>`<div class="page-thumb"><img src="${src}" alt="Page ${i+1}"></div>`).join('')}</div><div class="card" style="padding:14px;margin-top:13px"><div class="eyebrow">ILLUSTRATIVE FIELDS</div><p class="modal-description" style="margin-bottom:0">No OCR or medical AI was run. Review all information against the source document.</p></div><div class="upload-meta"><div class="field"><label for="editDocTitle">Record title</label><input id="editDocTitle" value="${esc(doc.title)}"></div><div class="field"><label for="editDocWho">Family member</label><select id="editDocWho">${members.map(m=>`<option ${m.name===doc.who?'selected':''}>${esc(m.name)}</option>`).join('')}</select></div></div><div class="modal-actions"><button class="btn" type="button" data-dismiss>Close</button><button class="btn btn-primary" type="button" id="saveDocMeta">Save details</button></div>`);
  document.getElementById('saveDocMeta').onclick=()=>{const previous=members.find(m=>m.name===doc.who),nextName=document.getElementById('editDocWho').value;if(previous&&previous.name!==nextName)previous.docs=Math.max(0,previous.docs-1);const next=members.find(m=>m.name===nextName);if(next&&previous?.name!==nextName)next.docs+=1;doc.title=document.getElementById('editDocTitle').value.trim()||doc.title;doc.who=nextName;closeModal();render(activeView);notify('Record details updated locally.')};
  const actions=document.querySelector('#modalContent .modal-actions');
  const remove=document.createElement('button');remove.type='button';remove.className='btn btn-destructive btn-sm';remove.textContent='Remove record';actions.prepend(remove);
  remove.addEventListener('click',()=>{openModal(`<div class="eyebrow">CONFIRM REMOVAL</div><h2>Remove this record?</h2><p class="modal-description">“${esc(doc.title)}” will be removed from this local prototype view.</p><div class="modal-actions"><button class="btn" type="button" data-dismiss>Keep record</button><button class="btn btn-destructive" type="button" id="confirmRemoveDoc">Remove record</button></div>`);document.getElementById('confirmRemoveDoc').addEventListener('click',()=>{docs=docs.filter(item=>item!==doc);const m=members.find(item=>item.name===doc.who);if(m)m.docs=Math.max(0,m.docs-1);closeModal();render(activeView);notify('Record removed from this preview.')})});
}
function commandMenu(){
  closeMenus();openModal(`<div class="eyebrow">QUICK NAVIGATION · ESC TO CLOSE</div><h2>Where would you like to go?</h2><div class="field"><label for="commandSearch">Search pages and actions</label><input id="commandSearch" placeholder="Try “medications” or “add a record”"></div><div id="commandResults" class="command-results"></div>`);
  const input=document.getElementById('commandSearch');const results=document.getElementById('commandResults');
  const items=[['overview','⌂','Overview'],['family','♧','Family members'],['vault','▤','Medical vault'],['timeline','◷','Health timeline'],['medications','✳','Medications'],['emergency','⌗','Emergency access'],['labs','＋','Labs & care'],['settings','⚙','Settings'],['add','⇧','Add a medical record']];
  const paint=()=>{const q=input.value.toLowerCase();results.innerHTML=items.filter(x=>x[2].toLowerCase().includes(q)).map(x=>`<button class="command-item" type="button" data-command="${x[0]}"><span>${x[1]}</span>${x[2]}<span style="margin-left:auto;color:#98a39b">↵</span></button>`).join('')||'<div class="empty-state">No matching pages or actions.</div>'};
  paint();input.addEventListener('input',paint);results.addEventListener('click',e=>{const b=e.target.closest('[data-command]');if(!b)return;closeModal();if(b.dataset.command==='add')showUpload();else render(b.dataset.command)});setTimeout(()=>input.focus(),0);
}
function focusableMenuKeys(e){if(!menuNodes.size)return;const menu=[...menuNodes][0],items=[...menu.querySelectorAll('[role=menuitem]')];if(!items.length)return;let i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();i=(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[i].focus()}if(e.key==='Home'){e.preventDefault();items[0].focus()}if(e.key==='End'){e.preventDefault();items.at(-1).focus()}}

document.addEventListener('click',e=>{
  const upload=e.target.closest('[data-action="upload"]');
  if(upload){e.preventDefault();e.stopImmediatePropagation();closeMenus();showUpload();return;}
  if(e.target.closest('#topProfile')||e.target.closest('#profileMenu')){e.preventDefault();e.stopImmediatePropagation();const a=e.target.closest('#topProfile')||e.target.closest('#profileMenu');if(menuNodes.size)closeMenus();else openProfileMenu(a);return;}
  if(e.target.closest('#notifications')){e.preventDefault();e.stopImmediatePropagation();const a=e.target.closest('#notifications');if(menuNodes.size)closeMenus();else openNotificationMenu(a);return;}
  const searchDoc=e.target.closest('[data-search-doc]');if(searchDoc){const d=docs.find(x=>x.title===searchDoc.dataset.searchDoc);closeMenus();if(d)showDocumentDetail(d);return;}
  const searchPerson=e.target.closest('[data-search-person]');if(searchPerson){const m=members.find(x=>x.id===searchPerson.dataset.searchPerson);closeMenus();if(m&&typeof mvOpenProfile==='function')mvOpenProfile(m.id);else render('family');return;}
  if(e.target.closest('[data-search-all]')){const q=document.getElementById('globalSearch').value;closeMenus();if(typeof mvSearchAll==='function'){mvSearchAll(q);return;}render('vault');const f=document.getElementById('vaultSearch');f.value=q;f.dispatchEvent(new Event('input',{bubbles:true}));return;}
  const docEl=e.target.closest('[data-doc]');
  if(docEl){const item=docs.find(x=>x.title===docEl.dataset.doc);if(item){e.preventDefault();e.stopImmediatePropagation();showDocumentDetail(item);return;}}
},true);

dialog.addEventListener('close',()=>stopCamera());
dialog.addEventListener('cancel',()=>stopCamera());
document.addEventListener('click',e=>{
  const action=e.target.closest('[data-menu-action]');if(action){const key=action.dataset.menuAction;closeMenus();if(key==='settings'||key==='landing'||key==='vault'||key==='medications')render(key);else if(key==='profile')render('settings');return;}
  if(menuNodes.size&&!e.target.closest('.menu-popover'))closeMenus();
  if(e.target.closest('[data-camera-start]')){startCamera();return;}
  if(e.target.closest('[data-open-files]')){document.getElementById('multiFiles')?.click();return;}
  if(e.target.closest('[data-camera-fallback]')){document.getElementById('captureFallback')?.click();return;}
  if(e.target.closest('#capturePhoto')){captureFrame();return;}
  if(e.target.closest('[data-camera-cancel]')){stopCamera();showUpload();return;}
  if(e.target.closest('[data-retake]')){uploadSession.pages.pop();startCamera();return;}
  if(e.target.closest('[data-review-pages]')){showReview();return;}
  const remove=e.target.closest('[data-remove-page]');if(remove){const i=Number(remove.dataset.removePage),p=uploadSession.pages.splice(i,1)[0];if(p?.url)URL.revokeObjectURL(p.url);showReview();return;}
  if(e.target.closest('[data-upload-back]')){showUpload();return;}
  if(e.target.closest('[data-finalize]')){finishRecord();return;}
  if(e.target.closest('#collapseNav')){const collapsed=document.body.classList.toggle('sidebar-collapsed');const control=document.getElementById('collapseNav');control.setAttribute('aria-expanded',String(!collapsed));control.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');document.querySelectorAll('.sidebar .nav-item').forEach(item=>{if(collapsed){const label=item.textContent.trim();item.title=label;item.setAttribute('aria-label',label)}else{item.removeAttribute('title');item.removeAttribute('aria-label')}});return;}
   if(e.target.closest('#mobileMenu')){setTimeout(()=>{const open=document.getElementById('sidebar').classList.contains('open'),backdrop=document.getElementById('mobileBackdrop'),button=document.getElementById('mobileMenu');backdrop.classList.toggle('show',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close navigation':'Open navigation')},0);return;}
   if(e.target.closest('#mobileBackdrop')){document.getElementById('sidebar').classList.remove('open');document.getElementById('mobileBackdrop').classList.remove('show');const button=document.getElementById('mobileMenu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation');button.focus();return;}
},false);
document.addEventListener('keydown',e=>{
  focusableMenuKeys(e);
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();commandMenu();}
 if(e.key==='Escape'){closeMenus(true);stopCamera();document.getElementById('mobileBackdrop').classList.remove('show');document.getElementById('sidebar').classList.remove('open');const button=document.getElementById('mobileMenu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation');}
  if(menuNodes.size&&e.key==='Tab'&&e.shiftKey&&document.activeElement=== [...menuNodes][0].querySelector('[role=menuitem]')){e.preventDefault();[...menuNodes][0].querySelector('[role=menuitem]:last-child')?.focus();}
});
document.addEventListener('input',e=>{if(e.target.id==='globalSearch'){if(typeof mvHandleGlobalSearch==='function'){mvHandleGlobalSearch(e);return;}e.stopImmediatePropagation();showSearchMenu(e.target);}},true);
document.getElementById('globalSearch').addEventListener('focus',e=>showSearchMenu(e.target));
document.getElementById('globalSearch').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){const first=[...menuNodes][0]?.querySelector('button');if(first){e.preventDefault();first.focus()}}if(e.key==='Escape')closeMenus(true)});
document.addEventListener('click',e=>{const view=e.target.closest('[data-view]');if(view){document.getElementById('mobileBackdrop').classList.remove('show');document.getElementById('sidebar').classList.remove('open');const button=document.getElementById('mobileMenu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation');}},true);
document.getElementById('globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.value.trim()){if(typeof mvSearchAll==='function'){e.preventDefault();mvSearchAll(e.target.value);return;}const input=document.getElementById('vaultSearch');if(activeView!=='vault')render('vault');const field=document.getElementById('vaultSearch');field.value=e.target.value;field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();}});
function attachHeroPointer(){const hero=document.querySelector('.editorial-hero');if(hero&&matchMedia('(pointer:fine)').matches&&!matchMedia('(prefers-reduced-motion: reduce)').matches){hero.addEventListener('pointermove',e=>{const r=hero.getBoundingClientRect();hero.style.setProperty('--mx',`${e.clientX-r.left}px`);hero.style.setProperty('--my',`${e.clientY-r.top}px`)});hero.addEventListener('pointerleave',()=>{hero.style.setProperty('--mx','70%');hero.style.setProperty('--my','40%')});}}
const renderWithHero=render;
render=function(view=activeView){renderWithHero(view);attachHeroPointer();};
render(activeView);
