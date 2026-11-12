/* Local prototype adapter. Replace task deadlines and recognition with service APIs in production. */
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const FORMATS = ['单选题','多选题','判断题','连线题','填空题','主观题'];
const PART_FIELDS = ['stem','display','type','options','correct','answer','analysis','rich'];
let activePart = 0, sourcePage = 1, sourceCount = 1, sourceToken = 0;
const sourceFiles = new Map();
const sourceDB = new Promise((resolve,reject) => {
  const req = indexedDB.open('paper-source-v5',1);
  req.onupgradeneeded = () => req.result.createObjectStore('files');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function storeSource(id, files) {
  const db = await sourceDB;
  await new Promise((resolve,reject) => {
    const tx=db.transaction('files','readwrite'); tx.objectStore('files').put(files,id);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
async function readSource(id) {
  if(sourceFiles.has(id)) return sourceFiles.get(id);
  const db=await sourceDB;
  return new Promise((resolve,reject)=> { const r=db.transaction('files').objectStore('files').get(id); r.onsuccess=()=>resolve(r.result || []); r.onerror=()=>reject(r.error); });
}
const copy = value => JSON.parse(JSON.stringify(value));
function partSnapshot(q) { return Object.fromEntries(PART_FIELDS.map(k=>[k,copy(q[k] ?? (k==='options'?[]:k==='correct'?0:k==='rich'?{}:''))])); }
function normalizeQuestion(q) {
  q.display ||= q.type === '解答题' ? '主观题' : '单选题'; q.options ||= []; q.tags ||= [];
  // Keep separately structured options from repeating inside the stem.
  if(!q.rich?.stem&&q.options.length>1){const suffix=q.stem?.match(/\nA[.．、][\s\S]*$/);if(suffix){const entries=suffix[0].split(/\n[A-H][.．、]\s*/).slice(1);const compact=text=>String(text).replace(/\s/g,'');if(entries.length===q.options.length&&entries.every((text,i)=>compact(text)===compact(q.options[i])))q.stem=q.stem.slice(0,suffix.index);}}
  if(q.count === '一题多问' && !q.parts) {
    q.parts=[partSnapshot(q),{stem:'(2) What does Grandpa have in his garden?',display:'主观题',type:'解答题',options:[],correct:0,answer:'',analysis:''}];
  }
  q.parts?.forEach(p=>{p.display ||= '主观题';p.options ||= [];p.type ||= ['单选题','多选题','判断题'].includes(p.display)?'选择题':p.display==='主观题'?'解答题':p.display;});
}
state.tasks.forEach(t=>t.questions.forEach(normalizeQuestion));
state.questions.forEach(normalizeQuestion);
function syncPart(q=currentQuestion()) { if(q?.count==='一题多问' && q.parts?.[activePart]) Object.assign(q.parts[activePart],partSnapshot(q)); }
function selectPart(i) { const q=currentQuestion();syncPart(q);activePart=i;Object.assign(q,copy(q.parts[i]));renderAi(); }
const sampleTemplate = copy(state.questions);
const originalMakeRecord = makeRecord;
makeRecord = function(args) { const t=originalMakeRecord(args);t.questions=copy(sampleTemplate);t.activeId=t.questions[0].id;t.questions.forEach(q=>{q.status='待校验';q.aiStatus='解析完成';});return t; };
const originalPersist = persistRecords;
persistRecords = function() {
  const t=state.tasks.find(t=>t.id===state.activeTaskId);
  if(t && !$('#workbenchPage').classList.contains('hidden')) { syncPart();t.questions=state.questions;t.activeId=state.activeQuestionId;t.step=state.step; }
  originalPersist();
};
markDirty = function() {
  state.dirty=true;
  if(!$('#workbenchPage').classList.contains('hidden')) { const q=currentQuestion();q.status=state.step===1?'待校验':'待保存';q.aiStatus='解析完成';syncPart();syncTopAction();const status=$('#questionCards .card-title .pill');if(status){status.className=statusClass(q.status);status.textContent=q.status;}const dot=$(`[data-q="${q.id}"]`);dot?.classList.remove('done');if(state.step===2){const aiState=$('.ai-item.active .ai-state');if(aiState){aiState.className='ai-state done';aiState.textContent='● 待保存';}} }
  const savedCount=$('#aiSavedCount');if(savedCount)savedCount.innerHTML=`已保存 <strong>${state.questions.filter(q=>q.status==='已保存').length}</strong> / ${state.questions.length} 题`;
  persistRecords();
};
const originalSetActive = setActiveQuestion;
setActiveQuestion = function(id) { cancelSourceCapture();syncPart();activePart=0; const target=state.questions.find(q=>q.id===Number(id));if(target?.parts)Object.assign(target,copy(target.parts[0]));originalSetActive(id);persistRecords(); };
const originalOpenRecord = openRecord;
openRecord = function(id) {
  cancelSourceCapture();
  const t=state.tasks.find(t=>t.id===id); if(!t){toast('任务已失效或已删除，请刷新列表');renderMonitor();return;} if(notificationStatus(t)?.kind==='failed'){showTaskFailure(t);return;} if(['parsing','deep'].includes(t.stage)) { toast(t?.stage==='failed'?'解析失败，请重新上传原文件':'任务正在后台处理中，可在任务监控查看');return; }
  if(!$('#workbenchPage').classList.contains('hidden')) persistRecords();
  activePart=0;
  t.questions.forEach(normalizeQuestion);const target=t.questions.find(q=>q.id===t.activeId)||t.questions[0];if(target.parts)Object.assign(target,copy(target.parts[0]));
  $('#taskHub').classList.add('hidden');originalOpenRecord(id);sourcePage=1;sourceScale=100;applySourceScale();renderSource();
};
const originalRenderAi = renderAi;
renderAi = function() {
  originalRenderAi(); const q=currentQuestion();
  const count=$('#aiSavedCount');if(count)count.innerHTML=`已保存 <strong>${state.questions.filter(q=>q.status==='已保存').length}</strong> / ${state.questions.length} 题`;
  $('#prevAi').disabled=state.questions[0].id===q.id;
  $('#aiSubTabs').innerHTML=(q.parts || []).map((p,i)=>`<button class="pill-tab ${i===activePart?'active':''}" data-part="${i}">第 (${i+1}) 问</button>`).join('');
  $$('[data-part]',$('#aiSubTabs')).forEach(b=>b.onclick=()=>selectPart(Number(b.dataset.part)));
};
moveQuestion = function(offset) {
  syncPart(); const i=state.questions.findIndex(q=>q.id===state.activeQuestionId);
  setActiveQuestion(state.questions[Math.max(0,Math.min(state.questions.length-1,i+offset))].id);
  $('#questionCards').scrollTop=0;$('.ai-wrap').scrollTop=0;
};
function field(label,value,attribute,extra='') {
  return `<label class="field-label">${label}</label><div class="click-editor"><div class="rich-toolbar hidden" role="toolbar" aria-label="${label}编辑工具"><button data-command="bold" title="加粗"><b>B</b></button><button data-command="italic" title="斜体"><i>I</i></button><button data-command="underline" title="下划线"><u>U</u></button><span></span><button data-command="insertUnorderedList" title="列表">☷</button><button data-command="formula" title="插入公式">∑</button><button data-command="picture" title="插入配图">▧ 插入配图</button><button data-command="undo" title="撤销">↶</button><button class="finish-edit">完成编辑</button></div><div class="editor rich-content" contenteditable="false" aria-readonly="true" tabindex="0" role="textbox" aria-label="${label}" ${attribute}>${escapeHTML(value)||'<span class="empty-editor">点击补充内容</span>'}</div></div>`;
}
function formatSelect(p,idx) { return `<div class="format-row"><span class="format-label">展示形式</span><div class="format-choices" role="radiogroup" aria-label="第${idx+1}问展示形式">${FORMATS.map(f=>`<label class="format-choice ${p.display===f?'selected':''}"><input type="radio" name="display-${idx}" value="${f}" ${p.display===f?'checked':''} data-format="${idx}">${f}</label>`).join('')}</div></div>`; }
function contentEditor(p,idx,multi) {
  return `<section class="part-box"><div class="part-head"><strong>${multi?`第 (${idx+1}) 问`:'题目内容'}</strong>${multi?`<button class="btn btn-danger" data-remove-part="${idx}">删除小问</button>`:''}</div>${formatSelect(p,idx)}
    ${field('题干',p.stem,`data-edit-part="${idx}" data-field="stem"`)}
    ${['单选题','多选题','判断题'].includes(p.display)?field('选项（每行一项）',(p.options||[]).join('\n'),`data-edit-part="${idx}" data-field="options"`):''}
    <div class="answer-pair"><div>${field('原卷答案',p.answer || (p.options?.length? (Array.isArray(p.correct)?p.correct:[p.correct??0]).map(n=>String.fromCharCode(65+n)).join('、'):''),`data-edit-part="${idx}" data-field="answer"`,'placeholder="原卷未提供时可留空"')}</div>
    <div>${field('原卷解析',p.analysis,`data-edit-part="${idx}" data-field="analysis"`,'placeholder="原卷未提供时可留空"')}</div></div></section>`;
}
renderVerify = function() {
  cancelSourceCapture();
  const q=currentQuestion(); if(!q)return;normalizeQuestion(q);
  const i=state.questions.indexOf(q), multi=q.count==='一题多问';
  $('#qDots').innerHTML='<span>题号定位：</span>'+state.questions.map((x,n)=>`<button class="q-dot ${x.id===q.id?'active':''} ${x.status!=='待校验'?'done':''}" data-q="${x.id}" aria-label="第${n+1}题">${n+1}</button>`).join('');
  $$('[data-q]').forEach(b=>b.onclick=()=>setActiveQuestion(Number(b.dataset.q)));
  $('#questionCards').innerHTML=`<article class="question-card"><div class="card-head"><div class="card-title"><span>${escapeHTML(q.title)}</span><span class="${statusClass(q.status)}">${q.status}</span></div><span class="label-hint">${i+1} / ${state.questions.length} 题</span></div>
    
    <div class="structure-row question-settings"><label>题目结构</label><div id="questionStructure" class="structure-radios" role="radiogroup" aria-label="题目结构"><label><input type="radio" name="questionStructure" value="一题一问" ${!multi?'checked':''}>一题一问</label><label><input type="radio" name="questionStructure" value="一题多问" ${multi?'checked':''}>一题多问</label></div>${multi?'<button class="btn btn-ghost" id="addPart">添加小问</button>':''}</div>
    ${multi?`<section class="public-stem-box">${field('公共题干',q.publicStem,'id="publicStemVerify"')}</section>`:''}
    ${(multi?q.parts:[q]).map((p,n)=>contentEditor(p,n,multi)).join('')}

</article>`;
  $('#verifyActions').innerHTML=`<div class="footer-left"><button class="btn btn-danger" id="deleteVerify">删除</button><button class="btn btn-ghost" id="captureSource">截取重新识别</button></div><div class="footer-right"><button class="btn btn-ghost" id="prevVerify" ${i===0?'disabled':''}>上一题</button><button class="btn btn-ghost" id="nextVerify" ${i===state.questions.length-1?'disabled':''}>下一题</button><button class="btn btn-primary" id="saveNextVerify">校验通过</button></div>`;
  $('#prevVerify').onclick=()=>moveQuestion(-1);$('#nextVerify').onclick=()=>moveQuestion(1);$('#captureSource').onclick=captureSourcePage;
  $('#saveNextVerify').onclick=()=>{
    const parts=multi?q.parts:[q];
    if(!q.captureImages?.length && (parts.some(p=>!p.stem.trim()) || (multi && !q.publicStem?.trim()))) {toast('请先补充完整的题干');return;}
    q.status='已校验';state.dirty=false;syncPart();persistRecords();renderRecords();
    if(i<state.questions.length-1){moveQuestion(1);return;}
    const pending=state.questions.find(x=>!['已校验','已保存'].includes(x.status));
    if(pending){setActiveQuestion(pending.id);toast('已跳转至尚未校验的习题');return;}
    renderVerify();askDeepAnalysis();
  };
  $('#deleteVerify').onclick=()=>{
    if(state.questions.length===1){toast('至少保留一道题');return;}
    if(!confirm(`确认删除${q.title}？`))return;
    syncPart();state.questions.splice(i,1);activePart=0;state.activeQuestionId=state.questions[Math.min(i,state.questions.length-1)].id;
    state.questions.forEach((x,n)=>x.title=`第 ${n+1} 题`);state.dirty=false;persistRecords();renderVerify();renderAi();renderRecords();
  };
  const changeStructure=e=>{
    if(e.target.value==='一题一问' && q.parts?.length>1 && !confirm('切换为一题一问将合并所有小问题干，是否继续？')){renderVerify();return;}
    if(e.target.value==='一题多问'){q.parts=[partSnapshot(q),{stem:'',display:'主观题',type:'解答题',options:[],correct:0,answer:'',analysis:''}];q.publicStem='';}
    else {syncPart();q.stem=[q.publicStem,...q.parts.map(p=>p.stem)].filter(Boolean).join('\n');q.answer=q.parts.map((p,n)=>`(${n+1}) ${p.answer||''}`).join('\n');q.analysis=q.parts.map((p,n)=>`(${n+1}) ${p.analysis||''}`).join('\n');delete q.parts;q.display='主观题';q.type='解答题';q.options=[];q.correct=0;}
    q.count=e.target.value;activePart=0; if(q.parts)Object.assign(q,copy(q.parts[0]));markDirty();renderVerify();
  };
  $$('input[name=questionStructure]').forEach(el=>el.onchange=changeStructure);
  $('#publicStemVerify')?.addEventListener('input',e=>{q.publicStem=e.target.innerText;markDirty();});
  $('#addPart')?.addEventListener('click',()=>{q.parts.push({stem:'',display:'主观题',type:'解答题',options:[],correct:0,answer:'',analysis:''});markDirty();renderVerify();});
  $$('[data-remove-part]').forEach(b=>b.onclick=()=>{if(q.parts.length<=2){toast('一题多问至少保留两个小问');return;}syncPart();q.parts.splice(Number(b.dataset.removePart),1);activePart=0;Object.assign(q,copy(q.parts[0]));markDirty();renderVerify();});
  $$('[data-format]').forEach(el=>el.onchange=()=>{
    const n=Number(el.dataset.format),p=multi?q.parts[n]:q;p.display=el.value;
    if(p.display==='判断题'){p.options=['正确','错误'];p.correct=0;}
    if(['单选题','多选题'].includes(p.display) && p.options.length<2){p.options=['选项 A','选项 B'];p.correct=0;}
    p.type=['单选题','多选题','判断题'].includes(p.display)?'选择题':p.display==='主观题'?'解答题':p.display;
    if(multi&&n===activePart)Object.assign(q,copy(p));markDirty();renderVerify();
  });
  $$('[data-edit-part]').forEach(el=>el.oninput=()=>{const n=Number(el.dataset.editPart),p=multi?q.parts[n]:q;const key=el.dataset.field;const value=el.innerText;p[key]=key==='options'?value.split('\n'):value;p.rich ||= {};p.rich[key]=sanitizeRich(el.innerHTML);
    if(key==='answer'&&/^[A-H](?:[、,，\s]*[A-H])*$/.test(value.trim())) {const indices=value.toUpperCase().match(/[A-H]/g).map(x=>x.charCodeAt(0)-65);p.correct=p.display==='多选题'?indices:indices[0];}
    if(multi&&n===activePart)Object.assign(q,copy(p));markDirty();});
  wireRichEditors(q,multi);
  syncTopAction();iconRefresh();
};

function isWord(file) { return /\.docx$/i.test(file.name); }
setFileInputMode = function(mode) { const input=$('#fileInput');input.accept=mode==='image'?'.png,.jpg,.jpeg':'.docx,.pdf,.png,.jpg,.jpeg';input.multiple=mode===''||mode==='image'; };
addFiles = function(files) {
  const incoming=Array.from(files);
  if(incoming.some(f=>!isWord(f)&&!isPdf(f)&&!isImage(f))){toast('支持 DOCX、PDF、PNG、JPG；旧版 DOC 请另存为 DOCX');return;}
  if(incoming.some(f=>f.size>(isImage(f)?10:100)*1024*1024)){toast('Word / PDF 最大100MB，图片单张最大10MB');return;}
  const docs=incoming.filter(f=>!isImage(f));
  if((docs.length && (incoming.length>1||state.files.length)) || (state.files.length && state.uploadMode!=='image')){toast('Word / PDF 每次提交一个，请勿与图片混传');return;}
  if(!incoming.length)return;
  if(!docs.length && state.files.length+incoming.length>20){toast('图片最多20张，请分批提交');return;}
  state.files.push(...incoming);state.uploadMode=docs.length?(isWord(docs[0])?'word':'pdf'):'image';state.dirty=true;renderFiles();
  $('#addMoreBtn').classList.toggle('hidden',state.uploadMode!=='image');
};
const originalRenderFiles=renderFiles;
renderFiles=function(){originalRenderFiles();$('#addMoreBtn').classList.toggle('hidden',!!state.files.length&&state.uploadMode!=='image');};
let submitBusy=false;
beginParse = async function() {
  if(submitBusy)return;
  if(!state.files.length){toast('请先选择试卷文件');return;}
  submitBusy=true;$('#startParseBtn').disabled=true;
  try {
    const files=[...state.files];
    if(isPdf(files[0])) {const doc=await pdfjsLib.getDocument({data:await files[0].arrayBuffer(),standardFontDataUrl:'assets/vendor/standard_fonts/'}).promise; if(doc.numPages>30){await doc.destroy();throw Error('PDF最多支持30页');}await doc.destroy();}
    const course=Object.fromEntries(['subject','publisher','grade','term'].map(k=>[k,$('#'+k).value]));
    if(Object.values(course).some(v=>!v))throw Error('请完整选择教材信息');
    const t=makeRecord({name:files.length===1?files[0].name:`批量图片试卷_${files.length}张`,type:state.uploadMode,course,stage:'parsing'});
    await storeSource(t.id,files);sourceFiles.set(t.id,files);t.hasSource=true;t.readyAt=Date.now()+9000;t.events=[];
    state.tasks.unshift(t);taskEvent(t,'已提交，等待后台解析');state.files=[];state.uploadMode='';state.dirty=false;renderFiles();renderRecords();
    let note=$('#submittedNote');if(!note){note=document.createElement('div');note.id='submittedNote';note.className='task-submitted';$('.form-block').append(note);}
    note.textContent='任务已提交，完成后会通知你。可继续上传其他试卷，或在右侧解析列表查看状态。';
    toast('已提交后台任务，可继续其他操作');
  } catch(e){toast(e.message || '任务提交失败，请重试');} finally {submitBusy=false;$('#startParseBtn').disabled=false;}
};

// Source files survive page reloads in IndexedDB; no question bounding boxes are drawn.
pdfjsLib.GlobalWorkerOptions.workerSrc='assets/vendor/pdf.worker.min.js';
async function renderSource() {
  const token=++sourceToken,id=state.activeTaskId,t=state.tasks.find(t=>t.id===id),box=$('#sourceDocument');
  box.textContent='正在加载原文件…';sourceReady=false;
  try {
    const files=await readSource(id);if(token!==sourceToken)return;
    if(!files.length){
      sourceCount=1;
      box.innerHTML=t?.hasSource?'<div class="source-empty">原文件不可用，请重新上传以恢复预览。</div>':'<div class="source-sample"><h3>示例原卷 · 综合练习</h3><p>一、已知集合 A = {x | x² − x − 2 &lt; 0}，B = {x | −1 &lt; x &lt; 1}，求 A ∩ B。</p><p>A. {x|−1&lt;x&lt;1}　B. {x|0&lt;x&lt;1}<br>C. {x|1&lt;x&lt;2}　D. {x|−1&lt;x&lt;2}</p><p>二、Dick 和 Lily 参观爷爷的小花园。<br>Dick: This is my grandpa. He has a small garden.<br>Lily: Hi, Grandpa. Nice to meet you!</p><p>(1) Dick’s grandpa has a _____.<br>A. garden　B. zoo　C. farm</p><p>(2) What does Grandpa have in his garden?</p><p>三、观察网格图，计算阴影部分面积。</p><p>参考答案：1. A　2.(1) A<br>解析：A = (−1, 2)，B = (−1, 1)，故 A ∩ B = (−1, 1)。</p></div>';
      $('#sourceMeta').textContent=t?.hasSource?'原文件缺失':'示例原卷';$('#downloadSource').disabled=true;
    } else {
      $('#downloadSource').disabled=false; const f=files[0];$('#sourceMeta').textContent=isWord(f)?'Word 原文':isPdf(f)?'PDF 原文件':'图片原文件';
      if(isPdf(f)) {
        const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer(),standardFontDataUrl:'assets/vendor/standard_fonts/'}).promise;
        sourceCount=doc.numPages;const pages=document.createDocumentFragment();
        for(let n=1;n<=doc.numPages;n++) {
          if(token!==sourceToken)break;
          const page=await doc.getPage(n),viewport=page.getViewport({scale:1.2});
          const sheet=document.createElement('section');sheet.className='source-sheet';sheet.dataset.page=n;
          const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;sheet.append(canvas);pages.append(sheet);
        }
        if(token===sourceToken)box.replaceChildren(pages);await doc.destroy();
      } else if(isWord(f)) {
        sourceCount=1;const result=await mammoth.convertToHtml({arrayBuffer:await f.arrayBuffer()});if(token!==sourceToken)return;
        // Render semantic document content without retaining scripts, links or event handlers.
        const parsed=new DOMParser().parseFromString(result.value,'text/html'),safe=document.createElement('div');safe.className='source-word';
        const allowed=new Set(['P','H1','H2','H3','H4','STRONG','EM','B','I','U','TABLE','TBODY','TR','TD','TH','UL','OL','LI','BR','SUB','SUP']);
        function clean(node,parent){if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return;}if(node.nodeType!==1)return;if(node.tagName==='IMG'&&/^data:image\//.test(node.getAttribute('src')||'')){const img=document.createElement('img');img.src=node.getAttribute('src');parent.append(img);return;}const out=allowed.has(node.tagName)?document.createElement(node.tagName):document.createElement('span');parent.append(out);node.childNodes.forEach(n=>clean(n,out));}
        parsed.body.childNodes.forEach(n=>clean(n,safe));box.replaceChildren(safe);$('#sourceMeta').textContent='Word 原文 · 流式预览';
      } else {
        sourceCount=files.length;const images=document.createDocumentFragment();
        for(let n=0;n<files.length;n++){const img=new Image(),url=URL.createObjectURL(files[n]);img.src=url;await img.decode();URL.revokeObjectURL(url);const sheet=document.createElement('section');sheet.className='source-sheet';sheet.dataset.page=n+1;sheet.append(img);images.append(sheet);}
        if(token===sourceToken)box.replaceChildren(images);
      }
    }
    if(token!==sourceToken)return;
    sourceReady=true;applySourceScale();
  } catch(e) {if(token===sourceToken)box.innerHTML='<div class="source-empty">原文件预览失败，请检查文件是否损坏，或下载后查看。</div>';}
}
// Crop selection is performed on the original document itself.
let sourceCapture=null,sourceCaptureGeneration=0;
function cancelSourceCapture(){
  sourceCaptureGeneration++;if(sourceCapture){sourceCapture.overlay.remove();sourceCapture=null;}
  $('#sourceCaptureTools').classList.add('hidden');$('#sourceCaptureTools').replaceChildren();$('#sourcePreview').classList.remove('capturing');
}
function captureSourcePage(){
  if(!sourceReady){toast('请等待原文件加载完成');return;}
  cancelSourceCapture();const doc=$('#sourceDocument'),overlay=document.createElement('div');overlay.id='sourceCropOverlay';overlay.className='source-crop-overlay';overlay.innerHTML='<div id="sourceCropSelection" class="source-crop-selection hidden"><span>识别区域</span></div>';
  doc.append(overlay);const q=currentQuestion(),multi=q.count==='一题多问';
  sourceCapture={overlay,rect:null,start:null,taskId:state.activeTaskId,questionId:q.id,host:null};$('#sourcePreview').classList.add('capturing');
  const tools=$('#sourceCaptureTools');tools.classList.remove('hidden');tools.innerHTML=`<div class="capture-instruction">在原卷上拖动框选需要重新识别的区域</div><div class="capture-toolbar"><select id="recognitionTarget" aria-label="识别目标">${multi?'<option value="public">公共题干</option>':''}${(multi?q.parts:[q]).map((p,i)=>`<option value="${i}">第 (${i+1}) 问题干</option>`).join('')}</select><button id="cancelSourceCrop" class="btn btn-ghost">取消截取</button><button id="recognizeSourceCrop" class="btn btn-primary" disabled>AI识别选区</button></div><div id="sourceCropResult" class="hidden"><label>识别结果（请核对后替换）</label><textarea id="sourceCropText" class="editor" aria-label="识别结果"></textarea><button id="applySourceCrop" class="btn btn-primary">确认替换题干</button></div>`;
  const selection=$('#sourceCropSelection');
  function point(e){const r=doc.getBoundingClientRect();return {x:Math.max(0,Math.min(doc.clientWidth,e.clientX-r.left)),y:Math.max(0,Math.min(doc.clientHeight,e.clientY-r.top))};}
  overlay.onpointerdown=e=>{
    if(e.button!==0)return;e.preventDefault();const capture=sourceCapture;if(!capture)return;
    const host=Array.from(doc.querySelectorAll('canvas,img,.source-word,.source-sample')).find(el=>{const r=el.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;});
    if(!host)return;capture.host=host;capture.start=point(e);capture.rect=null;overlay.setPointerCapture(e.pointerId);selection.classList.remove('hidden');selection.style.width='0';selection.style.height='0';$('#recognizeSourceCrop').disabled=true;$('#sourceCropResult').classList.add('hidden');
  };
  overlay.onpointermove=e=>{
    const c=sourceCapture;if(!c?.start)return;const p=point(e),d=doc.getBoundingClientRect(),h=c.host.getBoundingClientRect();
    const end={x:Math.max(h.left-d.left,Math.min(h.right-d.left,p.x)),y:Math.max(h.top-d.top,Math.min(h.bottom-d.top,p.y))};
    c.rect={x:Math.min(end.x,c.start.x),y:Math.min(end.y,c.start.y),w:Math.abs(end.x-c.start.x),h:Math.abs(end.y-c.start.y)};
    Object.assign(selection.style,{left:c.rect.x+'px',top:c.rect.y+'px',width:c.rect.w+'px',height:c.rect.h+'px'});
  };
  const finish=()=>{if(!sourceCapture)return;sourceCapture.start=null;$('#recognizeSourceCrop').disabled=!sourceCapture.rect||sourceCapture.rect.w<12||sourceCapture.rect.h<12;};
  overlay.onpointerup=finish;overlay.onpointercancel=()=>{if(sourceCapture){sourceCapture.start=null;sourceCapture.rect=null;}selection.classList.add('hidden');$('#recognizeSourceCrop').disabled=true;};
  $('#cancelSourceCrop').onclick=cancelSourceCapture;
  $('#recognizeSourceCrop').onclick=recognizeSourceSelection;
  $('#applySourceCrop').onclick=()=>{
    const capture=sourceCapture;if(!capture||capture.taskId!==state.activeTaskId||capture.questionId!==currentQuestion().id)return;
    const value=$('#sourceCropText').value.replace(/^【识别演示结果，请核对】/,'').trim(),q=currentQuestion();if(!value){toast('请补充识别结果');return;}
    const target=capture.resultTarget;if(target==='public'){q.publicStem=value;delete q.publicRich;}else{const n=Number(target),p=q.parts?.[n]||q;p.stem=value;if(p.rich)delete p.rich.stem;if(!q.parts||n===activePart){q.stem=value;if(q.rich)delete q.rich.stem;}}
    cancelSourceCapture();markDirty();renderVerify();toast('题干已替换，请重新校验');
  };
}
async function recognizeSourceSelection(){
  const capture=sourceCapture;if(!capture?.rect)return;const generation=++sourceCaptureGeneration,button=$('#recognizeSourceCrop'),target=$('#recognitionTarget').value;
  button.disabled=true;button.textContent='正在识别…';capture.overlay.style.pointerEvents='none';$('#recognitionTarget').disabled=true;
  try{
    const host=capture.host,display=host.getBoundingClientRect(),docRect=$('#sourceDocument').getBoundingClientRect(),rect=capture.rect;
    let original=host;if(host.tagName!=='CANVAS'&&host.tagName!=='IMG')original=await html2canvas(host,{scale:1.5,backgroundColor:'#fff',logging:false});
    const sx=(original.naturalWidth||original.width)/display.width,sy=(original.naturalHeight||original.height)/display.height;
    const result=document.createElement('canvas');result.width=Math.max(1,Math.round(rect.w*sx));result.height=Math.max(1,Math.round(rect.h*sy));result.getContext('2d').drawImage(original,(rect.x-(display.left-docRect.left))*sx,(rect.y-(display.top-docRect.top))*sy,rect.w*sx,rect.h*sy,0,0,result.width,result.height);
    const bitmap=result.toDataURL('image/png');await new Promise(resolve=>setTimeout(resolve,800));
    if(sourceCapture!==capture||generation!==sourceCaptureGeneration||capture.taskId!==state.activeTaskId||capture.questionId!==currentQuestion().id)return;
    capture.resultTarget=target;const q=currentQuestion();$('#sourceCropText').value='【识别演示结果，请核对】'+(target==='public'?q.publicStem:(q.parts?.[Number(target)]||q).stem);$('#sourceCropText').dataset.selectionBytes=bitmap.length;$('#sourceCropResult').classList.remove('hidden');toast('识别演示完成，请核对结果后替换');
  }catch(e){if(sourceCapture===capture)toast('选区识别失败，请重新框选');}
  finally{if(sourceCapture===capture){button.disabled=false;button.textContent='AI识别选区';capture.overlay.style.pointerEvents='';$('#recognitionTarget').disabled=false;}}
}

/* Global task inbox and workflow integration are installed below. */
// Answer controls follow each small question's display format, including multi-select.
renderOptions = function() {
  const q=currentQuestion(),row=$('#answerRow'),choice=['单选题','多选题','判断题'].includes(q.display),multi=q.display==='多选题';
  $('#choiceBlock').style.display=choice?'block':'none';$('#answerTextWrap').style.display=choice?'none':'block';$('#aiAnswer').value=q.answer||'';
  if(!choice)return;
  q.options ||= []; const correct=Array.isArray(q.correct)?q.correct:[Number(q.correct||0)];
  row.innerHTML=q.options.map((text,i)=>`<div class="option-item ${correct.includes(i)?'is-correct':''}"><input type="${multi?'checkbox':'radio'}" name="answer" ${correct.includes(i)?'checked':''} data-pick="${i}" aria-label="将 ${String.fromCharCode(65+i)} 设为正确答案"><span class="opt-letter">${String.fromCharCode(65+i)}</span><input class="opt-text" value="${escapeHTML(text)}" data-text="${i}" aria-label="选项 ${String.fromCharCode(65+i)} 内容"><button class="mini-danger" data-del="${i}" ${q.options.length<=2?'disabled':''}>删除</button></div>`).join('');
  $$('[data-pick]',row).forEach(el=>el.onchange=()=>{const i=Number(el.dataset.pick);q.correct=multi?(el.checked?[...new Set([...correct,i])]:correct.filter(n=>n!==i)):i;q.answer=(Array.isArray(q.correct)?q.correct:[q.correct]).map(n=>String.fromCharCode(65+n)).join('、');markDirty();renderOptions();});
  $$('[data-text]',row).forEach(el=>el.oninput=()=>{q.options[Number(el.dataset.text)]=el.value;markDirty();});
  $$('[data-del]',row).forEach(el=>el.onclick=()=>{const i=Number(el.dataset.del);q.options.splice(i,1);const next=correct.filter(n=>n!==i).map(n=>n>i?n-1:n);q.correct=multi?next:next[0]??0;q.answer=(Array.isArray(q.correct)?q.correct:[q.correct]).map(n=>String.fromCharCode(65+n)).join('、');markDirty();renderOptions();});
  $('#answerHint').textContent=`共 ${q.options.length} 个选项 · 正确答案 ${correct.map(n=>String.fromCharCode(65+n)).join('、')||'未选择'}`;
};

// Inline rich editing keeps the entire question visible until the teacher clicks it.
function sanitizeRich(html) {
  const doc=new DOMParser().parseFromString(html,'text/html'),out=document.createElement('div');
  const allowed=new Set(['B','STRONG','I','EM','U','P','DIV','BR','UL','OL','LI','SUB','SUP']);
  function visit(node,parent){
    if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return;}
    if(node.nodeType!==1)return;
    if(['SCRIPT','STYLE','IFRAME','OBJECT'].includes(node.tagName))return;
    if(node.tagName==='IMG' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(node.getAttribute('src')||'')){const img=new Image();img.src=node.getAttribute('src');img.alt='习题配图';parent.append(img);return;}
    const el=allowed.has(node.tagName)?document.createElement(node.tagName):document.createElement('span');parent.append(el);node.childNodes.forEach(n=>visit(n,el));
  }
  doc.body.childNodes.forEach(n=>visit(n,out));return out.innerHTML;
}
function wireRichEditors(q,multi) {
  $$('.click-editor').forEach(wrap=>{
    const content=wrap.querySelector('.rich-content'),toolbar=wrap.querySelector('.rich-toolbar'),index=Number(content.dataset.editPart||0);
    const owner=content.id==='publicStemVerify'?q:(multi?q.parts[index]:q),key=content.id==='publicStemVerify'?'publicStem':content.dataset.field;
    const richValue=key==='publicStem'?q.publicRich:owner.rich?.[key];if(richValue)content.innerHTML=sanitizeRich(richValue);
    const originalInput=content.oninput;
    content.oninput=e=>{
      if(originalInput)originalInput(e);
      if(content.id==='publicStemVerify'){q.publicStem=content.innerText;q.publicRich=sanitizeRich(content.innerHTML);markDirty();}
      wrap.classList.add('changed');
    };
    function start(){if(content.contentEditable==='true')return;const empty=content.querySelector('.empty-editor');if(empty)empty.remove();content.contentEditable='true';content.setAttribute('aria-readonly','false');toolbar.classList.remove('hidden');wrap.classList.add('editing');content.focus();}
    function finish(){content.contentEditable='false';content.setAttribute('aria-readonly','true');toolbar.classList.add('hidden');wrap.classList.remove('editing');if(!content.innerText.trim()&&!content.querySelector('img'))content.innerHTML='<span class="empty-editor">点击补充内容</span>';}
    content.onclick=start;content.onkeydown=e=>{if(e.key==='Enter'&&content.contentEditable!=='true'){e.preventDefault();start();}if(e.key==='Escape'){finish();content.blur();}};
    wrap.onfocusout=()=>setTimeout(()=>{if(!wrap.contains(document.activeElement))finish();},0);
    toolbar.onmousedown=e=>{if(e.target.closest('[data-command]'))e.preventDefault();};
    wrap.querySelector('.finish-edit').onclick=finish;
    toolbar.querySelectorAll('[data-command]').forEach(btn=>btn.onclick=()=>{
      const cmd=btn.dataset.command;content.focus();
      if(cmd==='formula'){const text=prompt('输入公式（例如 x² + y² = z²）');if(text)document.execCommand('insertText',false,text);}
      else if(cmd==='picture'){
        const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
        const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
        input.onchange=()=>{const file=input.files[0];if(!file)return;if(file.size>5*1024*1024){toast('配图最大支持5MB');return;}const reader=new FileReader();reader.onload=()=>{if(!document.contains(content))return;content.focus();if(range){selection.removeAllRanges();selection.addRange(range);}document.execCommand('insertImage',false,reader.result);content.dispatchEvent(new Event('input',{bubbles:true}));};reader.readAsDataURL(file);};input.click();
      } else document.execCommand(cmd,false,null);
      content.dispatchEvent(new Event('input',{bubbles:true}));
    });
    content.onpaste=e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));};
  });
}

// All original pages share one vertical viewport and one set of zoom controls.
let sourceScale=100,sourceReady=false;
function applySourceScale(){const doc=$('#sourceDocument');doc.style.width=sourceScale+'%';doc.style.maxWidth='none';$('#sourceZoom').textContent=sourceScale+'%';}
$('#zoomOut').onclick=()=>{cancelSourceCapture();sourceScale=Math.max(50,sourceScale-10);applySourceScale();};
$('#zoomIn').onclick=()=>{cancelSourceCapture();sourceScale=Math.min(200,sourceScale+10);applySourceScale();};
$('#zoomFit').onclick=()=>{cancelSourceCapture();sourceScale=100;applySourceScale();};

$('#downloadSource').onclick=async()=>{const files=await readSource(state.activeTaskId);for(const f of files){const a=document.createElement('a'),u=URL.createObjectURL(f);a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}};
$('.ai-main').append($('.bottom-row'));
const aiFooter=$('.ai-main > .bottom-row'),aiFooterActions=document.createElement('div');aiFooterActions.className='ai-footer-actions';aiFooterActions.append($('#prevAi'),$('#nextAi'));aiFooter.innerHTML='<span id="aiSavedCount" class="ai-saved-count">已保存 <strong>0</strong> / 0 题</span>';aiFooter.append(aiFooterActions);

// The surrounding task page demonstrates that floating reminders survive navigation.
const hub=document.createElement('section');hub.id='taskHub';hub.className='task-hub hidden';hub.innerHTML='<aside class="hub-sidebar"><button id="newPaper" class="btn btn-primary">＋ 解析试卷</button><span>我的班级</span><span>我的试卷</span><strong>我的任务</strong></aside><main class="hub-main"><div class="hub-filter"><h2>我的任务</h2><p>查看试卷处理记录，继续上次的校验与解析。</p><button id="hubUpload" class="btn btn-primary">上传试卷</button></div><div class="hub-content"><div id="hubTasks"></div></div></main>';
$('#app').append(hub);
function showUpload(){hub.classList.add('hidden');$('#workbenchPage').classList.add('hidden');$('#uploadPage').classList.remove('hidden');renderRecords();}
$('#newPaper').onclick=showUpload;$('#hubUpload').onclick=showUpload;
function renderHub(){
  $('#hubTasks').innerHTML=state.tasks.length?`<div class="hub-table-head"><span>文件名称</span><span>任务类型</span><span>目前环节</span><span>操作</span></div>`+state.tasks.map(t=>`<div class="hub-task"><strong>${escapeHTML(t.name)}</strong><span>试卷解析</span><span class="pill ${taskStatusOf(t).pill}">${taskStatusOf(t).label}</span><button class="btn btn-ghost" data-hub-open="${t.id}">查看</button></div>`).join(''):'<div class="hub-empty">暂无任务，点击「上传试卷」开始解析。</div>';
  $$('[data-hub-open]').forEach(b=>b.onclick=()=>openRecord(b.dataset.hubOpen));
}
const previousBack=doBack;
doBack=function(action){cancelSourceCapture();persistRecords();if(action==='upload'){state.dirty=false;$('#uploadPage').classList.add('hidden');$('#workbenchPage').classList.add('hidden');hub.classList.remove('hidden');renderHub();return;}previousBack(action);hub.classList.add('hidden');};

// A typed inbox is independent of permanent task records. Finished reminders are
// consumed on viewing, and expire after 24 hours. Running jobs retain their entry.
const INBOX_KEY='paper-task-inbox-v6',NOTICE_TTL=24*60*60*1000;
let notices=[];
try{const saved=JSON.parse(localStorage.getItem(INBOX_KEY)||'[]');if(Array.isArray(saved))notices=saved;}catch{}
const isRunning=t=>['parsing','deep'].includes(t.stage);
function saveInbox(){try{localStorage.setItem(INBOX_KEY,JSON.stringify(notices));}catch{}}
function notificationStatus(t){
 if(t.stage==='uploaded')return null;
 if(t.stage==='parsing')return {label:'结构化解析中',kind:'running'};
 if(t.stage==='deep')return {label:'习题解析中',kind:'running'};
 if(['failed','structure_failed','exercise_failed'].includes(t.stage)){
  const phase=t.failurePhase||t.failedPhase;
  const exercise=t.stage==='exercise_failed'||phase==='exercise'||phase==='deep'||(!phase&&t.stage!=='structure_failed'&&Number(t.step)===2);
  return {label:exercise?'习题解析失败':'结构化解析失败',kind:'failed'};
 }
 return {label:t.stage==='review'||Number(t.step)===2?'待上传':'待校验',kind:'finished'};
}
function formatTaskNotification(t){const status=notificationStatus(t);return status?`【试卷解析】${t.name} ${status.label}`:'';}
function showTaskFailure(t){
 const status=notificationStatus(t),reason=t.errorMessage||t.failureReason||(typeof t.error==='string'?t.error:t.error?.message)||'任务处理失败，请稍后重试。';
 openWorkflowDialog(status?.label||'解析失败',`${formatTaskNotification(t)}\n${reason}`,()=>{},'知道了',false);
}
function pruneNotices(){
 let changed=false;notices=notices.filter(n=>{const t=state.tasks.find(t=>t.id===n.taskId),status=t&&notificationStatus(t);if(!status||n.viewedAt||!Number.isFinite(n.expiresAt)||n.expiresAt<=Date.now()){changed=true;return false;}if(n.phase!==status.label||n.state!==status.kind){n.phase=status.label;n.state=status.kind;changed=true;}if(status.kind==='running'&&n.endTime){n.endTime=null;changed=true;}if(status.kind!=='running'&&!n.endTime){n.endTime=t.completedAt||(n.expiresAt-NOTICE_TTL);changed=true;}return true;});if(changed)saveInbox();
}
function updateNotice(t,message){
  const status=notificationStatus(t);if(!status){notices=notices.filter(n=>n.taskId!==t.id);saveInbox();return;}
  let n=notices.find(n=>n.taskId===t.id);
  const start=t.jobStartedAt||t.createdAt;
  if(!n){n={id:crypto.randomUUID(),taskId:t.id,typeKey:t.taskType||'paper_parse',type:t.taskTypeLabel||'试卷解析',startTime:start};notices.unshift(n);}
  n.phase=status.label;n.state=status.kind;n.endTime=status.kind==='running'?null:(t.completedAt||Date.now());n.expiresAt=(isRunning(t)?start:(t.completedAt||Date.now()))+NOTICE_TTL;delete n.viewedAt;saveInbox();
}
state.tasks.filter(isRunning).forEach(t=>{if(!notices.some(n=>n.taskId===t.id))updateNotice(t,'正在后台处理');});
const floating=document.createElement('div');floating.id='floatingTasks';floating.className='floating-tasks';floating.innerHTML='<button id="taskMonitor" class="floating-trigger" aria-expanded="false" aria-controls="monitorMask"><i data-lucide="bell" class="icon"></i><span>任务</span><b id="monitorBadge">0</b></button><div id="monitorMask" class="task-popover hidden"><section class="monitor-panel" role="dialog" aria-label="全局任务通知"><div class="monitor-head"><div class="monitor-heading"><h3>任务通知</h3><button id="closeMonitor" class="monitor-close" aria-label="关闭任务通知">×</button></div><div class="monitor-tabs"><button class="active" data-notice-tab="running">进行中 <b id="runningCount">0</b></button><button data-notice-tab="finished">已结束 <b id="finishedCount">0</b></button></div></div><div id="monitorFeed" class="monitor-feed"></div><div class="monitor-foot">已结束提醒查看后清除，24小时后自动失效。<button id="desktopNotify">桌面通知</button></div></section></div>';
document.body.append(floating);$('#toast').setAttribute('role','status');$('#toast').setAttribute('aria-live','polite');
let noticeTab='running',popoverTimer=null,popoverPinned=false;
const monitor=$('#monitorMask');
function openMonitor(){clearTimeout(popoverTimer);if(monitor.classList.contains('hidden'))noticeTab='running';monitor.classList.remove('hidden');$('#taskMonitor').setAttribute('aria-expanded','true');renderMonitor();}
function closeMonitor(){monitor.classList.add('hidden');popoverPinned=false;$('#taskMonitor').setAttribute('aria-expanded','false');}
$('#taskMonitor').onclick=()=>{if(popoverPinned){closeMonitor();return;}popoverPinned=true;openMonitor();};
floating.onmouseenter=openMonitor;floating.onmouseleave=()=>{if(!popoverPinned)popoverTimer=setTimeout(closeMonitor,300);};
$('#closeMonitor').onclick=closeMonitor;
$$('[data-notice-tab]').forEach(b=>b.onclick=()=>{noticeTab=b.dataset.noticeTab;renderMonitor();});
document.addEventListener('pointerdown',e=>{if(!floating.contains(e.target))closeMonitor();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!monitor.classList.contains('hidden')){$('#taskMonitor').focus();closeMonitor();}});
$('#taskMonitor').onfocus=()=>{if(!popoverPinned)openMonitor();};
function formatStart(ts){return new Date(ts).toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function renderMonitor(){
  pruneNotices();const running=notices.filter(n=>n.state==='running'),finished=notices.filter(n=>n.state!=='running');
  const count=state.tasks.filter(isRunning).length;
  $('#monitorBadge').textContent=count;$('#taskMonitor').classList.toggle('unread',finished.length>0);$('#taskMonitor').setAttribute('aria-label',`任务通知，${count}个进行中任务`);
  $('#runningCount').textContent=running.length;$('#finishedCount').textContent=finished.length;
  $$('[data-notice-tab]').forEach(b=>b.classList.toggle('active',b.dataset.noticeTab===noticeTab));
  if(monitor.classList.contains('hidden'))return;
  const list=noticeTab==='running'?running:finished;
  $('#monitorFeed').innerHTML=list.length?list.map(n=>{const t=state.tasks.find(t=>t.id===n.taskId);return `<article class="monitor-task"><div class="notice-title"><span class="notice-type">【${escapeHTML(n.type)}】</span><span class="pill ${isRunning(t)?'pill-purple':n.state==='failed'?'pill-red':'pill-green'}">${escapeHTML(n.phase)}</span></div><strong title="${escapeHTML(t.name)}">${escapeHTML(t.name)}</strong><div class="notice-task-meta"><dl><dt>任务开始时间</dt><dd>${formatStart(n.startTime)}</dd><dt>任务结束时间</dt><dd>${n.state==='running'?'—':formatStart(n.endTime)}</dd></dl><button class="btn btn-ghost notice-view" data-notice-view="${n.id}">查看</button></div></article>`;}).join(''):`<div class="record-empty">${noticeTab==='running'?'暂无进行中的任务':'暂无未查看的结束提醒'}</div>`;
  $$('[data-notice-view]').forEach(b=>b.onclick=()=>viewNotice(b.dataset.noticeView));
}
async function viewNotice(id){
  const n=notices.find(n=>n.id===id),t=n&&state.tasks.find(t=>t.id===n.taskId);
  if(!n||!t||n.expiresAt<=Date.now()){pruneNotices();renderMonitor();toast('该任务提醒已失效，请从解析记录查看');return;}
  const running=isRunning(t);
  if(running){showTaskDetail(t,n);return;}
  if(notificationStatus(t)?.kind==='failed'){notices=notices.filter(x=>x.id!==id);saveInbox();renderMonitor();closeMonitor();showTaskFailure(t);return;}
  if(t.hasSource){const files=await readSource(t.id).catch(()=>[]);if(!files.length){notices=notices.filter(x=>x.id!==id);saveInbox();renderMonitor();toast('原文件已失效，请重新上传；历史记录仍保留');return;}}
  // Revalidate after asynchronous file lookup to reject deleted/stale entries.
  if(!state.tasks.includes(t)||n.expiresAt<=Date.now()){pruneNotices();renderMonitor();toast('任务已失效，请刷新记录');return;}
  if(isRunning(t)){renderMonitor();showTaskDetail(t,n);return;}
  notices=notices.filter(x=>x.id!==id);saveInbox();renderMonitor();closeMonitor();
  if(notificationStatus(t)?.kind==='failed')showTaskFailure(t);else openRecord(t.id);
}
function showTaskDetail(t,n){
  openWorkflowDialog('任务详情',`${formatTaskNotification(t)}\n任务开始时间：${formatStart(n.startTime)}\n任务结束时间：${n.state==='running'?'—':formatStart(n.endTime)}`,()=>{},'知道了',false);
}
function taskEvent(t,message){
 const status=notificationStatus(t);if(!status){updateNotice(t,message);persistRecords();renderMonitor();return;}
 if(status.kind==='failed'&&!t.errorMessage&&message&&message!==status.label)t.errorMessage=message;
 const changed=t.lastNotifiedStatus!==status.label;
 if(changed){t.events ||= [];t.events.unshift({time:Date.now(),message:status.label});t.events=t.events.slice(0,15);t.lastNotifiedStatus=status.label;}
 t.updatedAt=Date.now();updateNotice(t,status.label);persistRecords();renderMonitor();
 if(!changed)return;
 const text=formatTaskNotification(t);toast(text);
 if(document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')new Notification('任务通知',{body:text});
}
$('#desktopNotify').onclick=async()=>{if(typeof Notification==='undefined'){toast('当前浏览器不支持桌面通知');return;}const permission=await Notification.requestPermission();toast(permission==='granted'?'桌面通知已开启':'将继续使用悬浮通知');};
const oldStatus=taskStatusOf;
taskStatusOf=function(t){const status=notificationStatus(t);if(!status)return oldStatus(t);return {key:status.kind==='failed'?'failed':t.stage==='parsing'?'parsing':t.stage==='deep'?'review':status.label==='待上传'?'ready':'verify',label:status.label,pill:status.kind==='failed'?'pill-red':status.kind==='running'?'pill-purple':status.label==='待上传'?'pill-green':'pill-yellow'};};
const originalRecords=renderRecords;
renderRecords=function(){originalRecords();renderMonitor();renderHub();};
function tickTasks(){
  for(const t of state.tasks){
    if(t.stage==='uploaded'&&t.events&&!t.notifiedUpload){t.notifiedUpload=true;t.completedAt=Date.now();updateNotice(t,'');persistRecords();}
    if(!isRunning(t)||!t.readyAt)continue;
    if(Date.now()>=t.readyAt){const deep=t.stage==='deep';t.completedAt=t.readyAt;t.stage=deep?'review':'verify';delete t.readyAt;if(deep)t.questions.forEach(q=>q.aiStatus='解析完成');taskEvent(t,deep?'AI深度解析完成，待核对与上传':'结构化解析完成，待题干与题量校验');renderRecords();
      if(deep && state.activeTaskId===t.id&&!$('#workbenchPage').classList.contains('hidden')&&state.step===2){renderAi();$('#aiBusyBanner')?.remove();}
    }else if(t.stage==='parsing'&&t.readyAt-Date.now()<5000&&!t.recognizing){t.recognizing=true;taskEvent(t,'识别题干、答案和解析，拆分小问');renderRecords();}
  }
  const size=notices.length;pruneNotices();if(notices.length!==size)renderMonitor();
}

// Confirmation actions are shared by the top action and the final verified question.
const dialog=document.createElement('div');dialog.id='workflowDialog';dialog.className='modal-mask';dialog.innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-labelledby="workflowTitle"><div class="modal-head"><span id="workflowTitle"></span><button id="workflowClose" class="btn btn-ghost" aria-label="关闭确认">×</button></div><div class="modal-body" id="workflowMessage"></div><div class="modal-actions"><button id="workflowCancel" class="btn btn-ghost">取消</button><button id="workflowConfirm" class="btn btn-primary">确定</button></div></div>';
document.body.append(dialog);
let dialogAction=null,dialogOrigin=null;
function closeWorkflowDialog(){dialog.classList.remove('show');dialogAction=null;dialogOrigin?.focus();}
function openWorkflowDialog(title,message,action,confirmText='确定',cancellable=true){dialogOrigin=document.activeElement;$('#workflowTitle').textContent=title;$('#workflowMessage').textContent=message;$('#workflowCancel').classList.toggle('hidden',!cancellable);$('#workflowConfirm').textContent=confirmText;dialogAction=action;dialog.classList.add('show');$('#workflowConfirm').focus();}
$('#workflowCancel').onclick=closeWorkflowDialog;$('#workflowClose').onclick=closeWorkflowDialog;
$('#workflowConfirm').onclick=()=>{const action=dialogAction;closeWorkflowDialog();action?.();};
dialog.onkeydown=e=>{if(e.key==='Escape')closeWorkflowDialog();if(e.key==='Tab'){const buttons=Array.from(dialog.querySelectorAll('button')).filter(b=>!b.classList.contains('hidden'));if(e.shiftKey&&document.activeElement===buttons[0]){buttons.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){buttons[0].focus();e.preventDefault();}}};
function askDeepAnalysis(){
  const pending=state.questions.filter(q=>!['已校验','已保存'].includes(q.status)).length;
  const taskId=state.activeTaskId;
  openWorkflowDialog('启用AI深度解析',pending?`存在${pending}道习题未校验，是否直接启用AI深度解析`:'校验完毕，是否启用AI深度解析',()=>{if(taskId!==state.activeTaskId||!state.tasks.some(t=>t.id===taskId)){toast('任务已失效，请重新打开');return;}startDeepAnalysis();});
}
function startDeepAnalysis(){
  cancelSourceCapture();
  syncPart();const t=state.tasks.find(t=>t.id===state.activeTaskId);if(!t||isRunning(t)){toast('任务正在处理中或已失效');return;}
  // Explicit confirmation also accepts any outstanding verification.
  state.questions.forEach(q=>{q.status='已校验';q.aiStatus='解析中';});
  t.stage='deep';t.jobStartedAt=Date.now();delete t.completedAt;t.readyAt=Date.now()+6500;t.questions=state.questions;state.dirty=false;
  oldSetStep(2);t.step=2;persistRecords();taskEvent(t,'AI深度解析中');renderRecords();
  const banner=document.createElement('div');banner.id='aiBusyBanner';banner.className='ai-busy-banner';banner.innerHTML='<span>AI正在后台深度解析，完成后可继续核对；你也可以返回处理其他任务。</span>';
  $('.ai-main').prepend(banner);
}
const oldSetStep=setStep;
setStep=function(step){cancelSourceCapture();const t=state.tasks.find(t=>t.id===state.activeTaskId);if(t?.stage==='deep'){toast('AI深度解析仍在后台处理中');return;}oldSetStep(step);persistRecords();};
syncTopAction=function(){const btn=$('#topAction');btn.disabled=false;btn.title=state.step===1?'可直接启动解析，未校验题目将再次确认':'';};
$('#topAction').addEventListener('click',e=>{if(state.step!==1)return;e.stopImmediatePropagation();askDeepAnalysis();},true);
$('#stepTwoBtn').addEventListener('click',e=>{e.stopImmediatePropagation();const t=state.tasks.find(t=>t.id===state.activeTaskId);if(t&&['review','uploaded'].includes(t.stage)){setStep(2);return;}if(t?.stage==='deep'){toast('AI深度解析仍在后台处理中');return;}askDeepAnalysis();},true);
// Prevent editing and saving while the job is still running, including keyboard focus.
const busyTargets=['.ai-wrap','.ai-main > .bottom-row','#topAction'];
function syncBusyState(){const busy=state.tasks.find(t=>t.id===state.activeTaskId)?.stage==='deep'&&!$('#workbenchPage').classList.contains('hidden');busyTargets.forEach(selector=>{const el=$(selector);if(el)el.inert=!!busy;});if(!busy)$('#aiBusyBanner')?.remove();}
const busyObserver=new MutationObserver(syncBusyState);busyObserver.observe($('#workbenchPage'),{attributes:true,attributeFilter:['class']});
const renderAiBeforeBusy=renderAi;renderAi=function(){renderAiBeforeBusy();syncBusyState();};
window.addEventListener('beforeunload',()=>{persistRecords();saveInbox();});
setInterval(tickTasks,1000);renderMonitor();renderHub();

// The center separator resizes the two panes without a separate preview mode.
const splitter=$('#paneSplitter');
let paneShare=44;
try{const saved=Number(localStorage.getItem('paper-pane-share-v7'));if(Number.isFinite(saved)&&saved>=25&&saved<=70)paneShare=saved;}catch{}
function setPaneShare(value){
  const panel=$('#verifyPanel'),mobile=matchMedia('(max-width:580px)').matches,rect=panel.getBoundingClientRect();if(!rect.width)rect.width=innerWidth;
  let min=mobile?23:Math.min(45,280/Math.max(rect.width,1)*100),max=mobile?60:Math.max(55,Math.min(70,(rect.width-350)/Math.max(rect.width,1)*100));
  paneShare=Math.max(min,Math.min(max,value));panel.style.setProperty('--paper-share',paneShare+'%');splitter.setAttribute('aria-valuenow',Math.round(paneShare));splitter.setAttribute('aria-valuemin',Math.round(min));splitter.setAttribute('aria-valuemax',Math.round(max));splitter.setAttribute('aria-orientation',mobile?'horizontal':'vertical');
}
let resizing=false;
splitter.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();cancelSourceCapture();resizing=true;splitter.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panes');};
splitter.onpointermove=e=>{if(!resizing)return;const r=$('#verifyPanel').getBoundingClientRect(),mobile=matchMedia('(max-width:580px)').matches;setPaneShare(mobile?(e.clientY-r.top)/r.height*100:(e.clientX-r.left)/r.width*100);};
function finishPaneResize(){resizing=false;document.body.classList.remove('resizing-panes');try{localStorage.setItem('paper-pane-share-v7',paneShare);}catch{}}
splitter.onpointerup=finishPaneResize;splitter.onpointercancel=finishPaneResize;
splitter.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();cancelSourceCapture();setPaneShare(e.key==='Home'?44:paneShare+(['ArrowLeft','ArrowUp'].includes(e.key)?-2:2));finishPaneResize();}};
setPaneShare(paneShare);

// A narrow dock at the screen edge can be dragged vertically. Dragging suppresses
// the ensuing click, and the popover follows the dock while staying in view.
let dockRatio=.52,dockPointer=null,dockDragging=false,suppressDockClick=false;
try{const saved=Number(localStorage.getItem('paper-task-dock-v7'));if(Number.isFinite(saved)&&saved>0&&saved<1)dockRatio=saved;}catch{}
function positionTaskPopover(){
  if(monitor.classList.contains('hidden'))return;
  const anchor=floating.getBoundingClientRect(),height=monitor.getBoundingClientRect().height;
  monitor.style.top=Math.max(12,Math.min(innerHeight-height-12,anchor.top))-anchor.top+'px';
}
function positionTaskDock(y=innerHeight*dockRatio){
  const height=$('#taskMonitor').getBoundingClientRect().height,footer=($('#workbenchPage').classList.contains('hidden')?0:Math.max($('#verifyActions').getBoundingClientRect().height||0,aiFooter.getBoundingClientRect().height||0));
  const minTop=$('#workbenchPage').classList.contains('hidden')?14:$('.topbar').getBoundingClientRect().bottom+12;
  const top=Math.max(minTop,Math.min(innerHeight-Math.max(footer,24)-height-14,y));floating.style.top=top+'px';floating.style.bottom='auto';positionTaskPopover();
}
const monitorOpenBase=openMonitor;
openMonitor=function(){if(dockDragging)return;monitorOpenBase();positionTaskPopover();};
const monitorRenderBase=renderMonitor;
renderMonitor=function(){monitorRenderBase();positionTaskPopover();};
const dockButton=$('#taskMonitor');dockButton.title='任务通知，可上下拖动调整位置';
dockButton.onpointerdown=e=>{if(e.button!==0)return;dockPointer={id:e.pointerId,y:e.clientY,top:floating.getBoundingClientRect().top};suppressDockClick=false;dockButton.setPointerCapture(e.pointerId);};
dockButton.onpointermove=e=>{
  if(!dockPointer)return;const delta=e.clientY-dockPointer.y;
  if(!dockDragging&&Math.abs(delta)>5){dockDragging=true;suppressDockClick=true;clearTimeout(popoverTimer);closeMonitor();floating.classList.add('dragging');}
  if(dockDragging){e.preventDefault();positionTaskDock(dockPointer.top+delta);}
};
function finishDockDrag(){if(dockDragging){dockRatio=floating.getBoundingClientRect().top/innerHeight;try{localStorage.setItem('paper-task-dock-v7',dockRatio);}catch{}suppressDockClick=true;}dockPointer=null;dockDragging=false;floating.classList.remove('dragging');}
dockButton.onpointerup=finishDockDrag;dockButton.onpointercancel=finishDockDrag;
dockButton.onclick=e=>{if(suppressDockClick){e.preventDefault();e.stopPropagation();suppressDockClick=false;return;}if(popoverPinned){closeMonitor();return;}popoverPinned=true;openMonitor();};
floating.onmouseenter=()=>{if(!dockPointer&&!dockDragging)openMonitor();};
dockButton.onfocus=()=>{if(!dockPointer&&!dockDragging&&!popoverPinned)openMonitor();};
dockButton.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();positionTaskDock(floating.getBoundingClientRect().top+(e.key==='ArrowUp'?-30:30));dockRatio=floating.getBoundingClientRect().top/innerHeight;try{localStorage.setItem('paper-task-dock-v7',dockRatio);}catch{}}});
window.addEventListener('resize',()=>{cancelSourceCapture();setPaneShare(paneShare);positionTaskDock();});
positionTaskDock();

const dockLayoutObserver=new MutationObserver(()=>positionTaskDock());dockLayoutObserver.observe($("#workbenchPage"),{attributes:true,attributeFilter:["class"]});
