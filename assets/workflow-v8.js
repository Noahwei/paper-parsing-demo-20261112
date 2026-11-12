/* Combined AI entry, ordered multi-capture questions and explicit upload targets. */
const aiPage=document.createElement('section');aiPage.id='globalAiPage';aiPage.className='global-ai-page hidden';aiPage.innerHTML='<header><button id="closeGlobalAi" class="btn btn-ghost">返回</button><strong>AI助手</strong><span>你的教学助手</span></header><main><div class="assistant-orb">AI</div><h1>有什么可以帮你？</h1><p>试卷解析任务会持续在后台处理，可悬停右侧AI入口查看进度。</p><div class="ai-suggestions"><button>查看解析任务</button><button>继续试卷校验</button></div><div class="ai-chat-log" id="aiChatLog"></div><form id="aiChatForm"><input id="aiChatInput" placeholder="输入你的教学问题" aria-label="向AI助手提问"><button class="btn btn-primary">发送</button></form><small>本地交互演示，尚未连接AI问答服务</small></main>';
$('#app').append(aiPage);
function showGlobalAi(){cancelSourceCapture();persistRecords();closeMonitor();aiPage.classList.remove('hidden');$('#aiChatInput').focus();}
$('#closeGlobalAi').onclick=()=>aiPage.classList.add('hidden');
$('.ai-suggestions button').onclick=()=>{openMonitor();};$('.ai-suggestions button:last-child').onclick=()=>{aiPage.classList.add('hidden');const t=state.tasks.find(t=>!isRunning(t)&&t.stage!=='failed');if(t)openRecord(t.id);else showUpload();};
$('#aiChatForm').onsubmit=e=>{e.preventDefault();const value=$('#aiChatInput').value.trim();if(!value)return;const row=document.createElement('p');row.textContent=value;$('#aiChatLog').append(row);const response=document.createElement('p');response.className='assistant-response';response.textContent='已收到你的问题。当前可体验试卷解析与任务通知流程，AI问答服务待接入。';$('#aiChatLog').append(response);$('#aiChatInput').value='';};
dockButton.innerHTML='<img class="ai-mascot" src="assets/jizai.png" alt="吉仔AI助手" draggable="false"><b id="monitorBadge" class="hidden">0</b>';
dockButton.title='点击打开AI助手，悬停查看任务；可上下拖动';
dockButton.onclick=e=>{if(suppressDockClick){e.preventDefault();e.stopPropagation();suppressDockClick=false;return;}showGlobalAi();};dockButton.onfocus=()=>{};
const updateAiEntryBase=renderMonitor;
renderMonitor=function(){updateAiEntryBase();const count=state.tasks.filter(isRunning).length;$('#monitorBadge').classList.toggle('hidden',count===0);dockButton.classList.toggle('has-tasks',count>0);dockButton.setAttribute('aria-label',count?`AI助手，${count}个任务进行中，悬停查看`:'AI助手，点击打开，悬停查看任务');};
const taskEventWithAiHint=taskEvent;let aiHintTimer;
taskEvent=function(t,message){const status=notificationStatus(t),changed=status&&t.lastNotifiedStatus!==status.label;taskEventWithAiHint(t,message);if(changed&&status.kind!=='running'){let hint=$('#aiTaskHint');if(!hint){hint=document.createElement('div');hint.id='aiTaskHint';hint.className='ai-task-hint';floating.append(hint);}hint.textContent=formatTaskNotification(t);clearTimeout(aiHintTimer);aiHintTimer=setTimeout(()=>hint.remove(),6000);}};

// Add a fully configured blank question after the current question.
const addDialog=document.createElement('div');addDialog.id='addQuestionDialog';addDialog.className='modal-mask';addDialog.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="addQuestionTitle"><div class="modal-head"><span id="addQuestionTitle">新增题目</span><button id="closeAddQuestion" class="btn btn-ghost">×</button></div><div class="modal-body"><p>在当前题目后新增，请先选择题目数量和展示形式。</p><label class="field-label">题目数量</label><div class="add-radio-row"><label><input type="radio" name="newStructure" value="一题一问" checked>一题一问</label><label><input type="radio" name="newStructure" value="一题多问">一题多问</label></div><label class="field-label">展示形式</label><div class="add-radio-row">${FORMATS.map((f,i)=>`<label><input type="radio" name="newDisplay" value="${f}" ${i===0?'checked':''}>${f}</label>`).join('')}</div></div><div class="modal-actions"><button id="cancelAddQuestion" class="btn btn-ghost">取消</button><button id="confirmAddQuestion" class="btn btn-primary">新增题目</button></div></div>`;document.body.append(addDialog);
let addOrigin=null;
function closeAdd(){addDialog.classList.remove('show');$('#addQuestion').focus();}
$('#addQuestion').onclick=()=>{addOrigin={taskId:state.activeTaskId,id:currentQuestion().id};addDialog.classList.add('show');$('#confirmAddQuestion').focus();};$('#closeAddQuestion').onclick=closeAdd;$('#cancelAddQuestion').onclick=closeAdd;
addDialog.onkeydown=e=>{if(e.key==='Escape')closeAdd();if(e.key==='Tab'){const buttons=Array.from(addDialog.querySelectorAll('button,input'));if(e.shiftKey&&document.activeElement===buttons[0]){buttons.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){buttons[0].focus();e.preventDefault();}}};
$('#confirmAddQuestion').onclick=()=>{
 const origin=addOrigin,index=state.questions.findIndex(q=>q.id===origin?.id);if(!origin||origin.taskId!==state.activeTaskId||index<0){closeAdd();toast('当前题目已失效，请重新新增');return;}
 syncPart();const display=$('input[name=newDisplay]:checked',addDialog).value,count=$('input[name=newStructure]:checked',addDialog).value;
 const q=copy(sampleTemplate[0]);Object.assign(q,{id:Math.max(...state.questions.map(q=>Number(q.id)))+1,count,stem:'',publicStem:'',display,type:['单选题','多选题','判断题'].includes(display)?'选择题':display==='主观题'?'解答题':display,options:display==='判断题'?['正确','错误']:['单选题','多选题'].includes(display)?['','']:[],correct:display==='多选题'?[]:0,answer:'',analysis:'',rich:{},status:'待校验',aiStatus:'解析完成',tags:[],captureImages:[]});delete q.parts;
 if(count==='一题多问')q.parts=[partSnapshot(q),partSnapshot(q)];state.questions.splice(index+1,0,q);state.questions.forEach((q,i)=>q.title=`第 ${i+1} 题`);closeAdd();setActiveQuestion(q.id);markDirty();renderRecords();toast('已在当前题目后新增，请补充题干或截取原卷');
};

// Each drag creates one image. Ordered thumbnails can be reordered or removed.
captureSourcePage=function(){
 if(!sourceReady){toast('请等待原文件加载完成');return;}cancelSourceCapture();
 const doc=$('#sourceDocument'),overlay=document.createElement('div');overlay.id='sourceCropOverlay';overlay.className='source-crop-overlay';overlay.innerHTML='<div id="sourceCropSelection" class="source-crop-selection hidden"></div>';doc.append(overlay);
 sourceCapture={overlay,items:[],start:null,rect:null,host:null,busy:false,taskId:state.activeTaskId,questionId:currentQuestion().id};$('#sourcePreview').classList.add('capturing');
 const c=sourceCapture,tools=$('#sourceCaptureTools');tools.classList.remove('hidden');tools.innerHTML='<div class="capture-instruction">可跨页、分栏连续截取，最多6张；截取后请先进行AI识别。</div><div id="captureThumbnails" class="capture-thumbnails"></div><div class="capture-toolbar"><span id="captureCount">已截取 0 张</span><button id="cancelSourceCrop" class="btn btn-ghost">取消截取</button><button id="recognizeCaptureImages" class="btn btn-primary" disabled>AI识别截图</button></div><div id="captureRecognitionResult" class="hidden"><label id="captureRecognitionLabel">AI识别结果</label><textarea id="captureRecognitionText" class="editor" aria-label="AI识别结果"></textarea><button id="applyCaptureImages" class="btn btn-primary" disabled>确认替换内容</button></div>';
 const selection=$('#sourceCropSelection');
 function point(e){const r=doc.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 overlay.onpointerdown=e=>{if(e.button!==0||c.busy)return;if(c.items.length>=6){toast('截图识别最多支持6张，请先删除一张再截取');return;}const host=Array.from(doc.querySelectorAll('canvas,img,.source-word,.source-sample')).find(el=>{const r=el.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;});if(!host)return;e.preventDefault();c.host=host;c.start=point(e);c.rect=null;overlay.setPointerCapture(e.pointerId);selection.classList.remove('hidden');selection.style.width='0';selection.style.height='0';};
 overlay.onpointermove=e=>{if(!c.start)return;const p=point(e),d=doc.getBoundingClientRect(),h=c.host.getBoundingClientRect(),end={x:Math.max(h.left-d.left,Math.min(h.right-d.left,p.x)),y:Math.max(h.top-d.top,Math.min(h.bottom-d.top,p.y))};c.rect={x:Math.min(end.x,c.start.x),y:Math.min(end.y,c.start.y),w:Math.abs(end.x-c.start.x),h:Math.abs(end.y-c.start.y)};Object.assign(selection.style,{left:c.rect.x+'px',top:c.rect.y+'px',width:c.rect.w+'px',height:c.rect.h+'px'});};
 overlay.onpointerup=async()=>{
  if(!c.start)return;c.start=null;if(!c.rect||c.rect.w<12||c.rect.h<12){selection.classList.add('hidden');return;}c.busy=true;$('#applyCaptureImages').disabled=true;$('#recognizeCaptureImages').disabled=true;const rect={...c.rect},host=c.host,display=host.getBoundingClientRect(),d=doc.getBoundingClientRect();
  try{let source=host;if(!['CANVAS','IMG'].includes(host.tagName))source=await html2canvas(host,{scale:1.5,backgroundColor:'#fff',logging:false});const sx=(source.naturalWidth||source.width)/display.width,sy=(source.naturalHeight||source.height)/display.height,out=document.createElement('canvas'),scale=Math.min(1,1200/(rect.w*sx));out.width=Math.max(1,Math.round(rect.w*sx*scale));out.height=Math.max(1,Math.round(rect.h*sy*scale));out.getContext('2d').drawImage(source,(rect.x-display.left+d.left)*sx,(rect.y-display.top+d.top)*sy,rect.w*sx,rect.h*sy,0,0,out.width,out.height);if(sourceCapture!==c)return;c.items.push({url:out.toDataURL('image/jpeg',.9),page:host.closest('.source-sheet')?.dataset.page||'1'});}
  catch{if(sourceCapture===c)toast('截取失败，请重新框选');}finally{if(sourceCapture===c){c.busy=false;selection.classList.add('hidden');renderCaptureThumbnails();}}
 };
 overlay.onpointercancel=()=>{c.start=null;c.rect=null;selection.classList.add('hidden');};$('#cancelSourceCrop').onclick=cancelSourceCapture;
 $('#recognizeCaptureImages').onclick=()=>recognizeCaptureBatch(c);
 $('#applyCaptureImages').onclick=()=>{if(sourceCapture!==c||c.busy||!c.items.length||c.items.length>6||!c.result||c.taskId!==state.activeTaskId||c.questionId!==currentQuestion().id)return;
  const text=$('#captureRecognitionText').value.trim();if(!text){toast('请核对并补充识别结果');return;}
  const q=currentQuestion(),previousQuestion=copy(q);syncPart();
  applyRecognizedContent(q,c.result,text);
  try{localStorage.setItem(STORE_KEY,JSON.stringify({tasks:state.tasks,activeTaskId:state.activeTaskId}));}catch{Object.keys(q).forEach(key=>delete q[key]);Object.assign(q,previousQuestion);toast('当前浏览器存储空间不足，请稍后重试');return;}
  cancelSourceCapture();markDirty();renderVerify();toast('识别内容已替换，可继续编辑和校验');
 };
};
function renderCaptureThumbnails(){const c=sourceCapture;if(!c)return;c.result=null;$('#captureRecognitionResult').classList.add('hidden');$('#recognizeCaptureImages').disabled=c.busy||!c.items.length;$('#captureCount').textContent=`已截取 ${c.items.length} / 6 张`;$('#applyCaptureImages').disabled=true;$('#captureThumbnails').innerHTML=c.items.map((item,i)=>`<div class="capture-thumbnail"><img src="${item.url}" alt="截取图片${i+1}"><span>${i+1} · 第${item.page}页</span><div><button data-shot-up="${i}" ${i===0?'disabled':''} aria-label="前移第${i+1}张">←</button><button data-shot-down="${i}" ${i===c.items.length-1?'disabled':''} aria-label="后移第${i+1}张">→</button><button data-shot-remove="${i}" aria-label="删除第${i+1}张">×</button></div></div>`).join('');
 $$('[data-shot-up]').forEach(b=>b.onclick=()=>{const i=+b.dataset.shotUp;[c.items[i-1],c.items[i]]=[c.items[i],c.items[i-1]];renderCaptureThumbnails();});$$('[data-shot-down]').forEach(b=>b.onclick=()=>{const i=+b.dataset.shotDown;[c.items[i+1],c.items[i]]=[c.items[i],c.items[i+1]];renderCaptureThumbnails();});$$('[data-shot-remove]').forEach(b=>b.onclick=()=>{c.items.splice(+b.dataset.shotRemove,1);renderCaptureThumbnails();});
}
// Recognition always returns to the existing editable question modules.
function clearCapturePresentation(q){delete q.captureImages;delete q.recognitionText;delete q.recognitionMode;}
function replaceContentFields(target,content){
 for(const key of ['stem','answer','analysis'])if(typeof content[key]==='string'){target[key]=content[key];if(target.rich)delete target.rich[key];}
 if(Array.isArray(content.options)&&content.options.every(x=>typeof x==='string')){target.options=copy(content.options);if(target.rich)delete target.rich.options;}
 if(content.correct!==undefined){const values=Array.isArray(content.correct)?content.correct:[content.correct];if(values.every(x=>Number.isInteger(x)&&x>=0&&x<(target.options||[]).length))target.correct=target.display==='多选题'?values:values[0];}
}
function applyRecognizedContent(q,result,text){
 clearCapturePresentation(q);const content=result.question||{};
 if(q.count==='一题多问'&&q.parts?.length){
  q.publicStem=typeof content.publicStem==='string'?content.publicStem:text;delete q.publicRich;
  q.parts.forEach((part,i)=>{if(content.parts?.[i])replaceContentFields(part,content.parts[i]);});
  Object.assign(q,copy(q.parts[Math.min(activePart,q.parts.length-1)]));
  if(text!==result.text)q.publicStem=text;
 }else{replaceContentFields(q,content);q.stem=text;if(q.rich)delete q.rich.stem;}
}
function migrateCapturePresentation(q){
 if(!q.captureImages?.length)return;
 const text=q.recognitionText||q.stem||'';clearCapturePresentation(q);
 if(q.count==='一题多问'&&q.parts?.length){q.publicStem=text;delete q.publicRich;q.parts.forEach(p=>{if(/^（第 .+ 问内容见截取图片）$/.test(p.stem||''))p.stem='';});Object.assign(q,copy(q.parts[0]));}
 else{q.stem=text;if(q.rich)delete q.rich.stem;}
}
state.tasks.forEach(t=>t.questions.forEach(migrateCapturePresentation));
const renderVerifyV7=renderVerify;
renderVerify=function(){migrateCapturePresentation(currentQuestion());renderVerifyV7();};
const renderAiV7=renderAi;
renderAi=function(){migrateCapturePresentation(currentQuestion());renderAiV7();$('#aiNumber').textContent=state.questions.indexOf(currentQuestion())+1;$('#reanalyzeBtn').lastChild.textContent='AI重新解析';$('#aiCapturedImages')?.remove();if(state.step===2)$('#topAction').innerHTML='上传题目 <span aria-hidden="true">⌄</span>';};

// Both upload entrances expose the same three destinations, with validation.
function uploadQuestions(destination,saveCurrent){
 const t=state.tasks.find(t=>t.id===state.activeTaskId);if(!t||isRunning(t)){toast('任务正在处理中或已失效');return;}
 if(saveCurrent){currentQuestion().status='已保存';currentQuestion().aiStatus='已保存';syncPart();}
 const unsaved=state.questions.filter(q=>q.status!=='已保存');if(unsaved.length){persistRecords();setActiveQuestion(unsaved[0].id);toast(`还有 ${unsaved.length} 道题未保存，请先保存`);return;}
 t.stage='uploaded';t.destination=destination;t.updatedAt=Date.now();t.completedAt=Date.now();t.notifiedUpload=true;state.dirty=false;state.files=[];state.uploadMode='';persistRecords();updateNotice(t,'');renderMonitor();doBack('workbench');toast(`已上传 ${t.questions.length} 道题至${destination}`);
}
function createUploadMenu(button,saveCurrent){const wrap=document.createElement('div');wrap.className='upload-destination';button.before(wrap);wrap.append(button);const menu=document.createElement('div');menu.className='upload-options';menu.setAttribute('role','menu');menu.innerHTML=['题库','作业','考试'].map(dest=>`<button role="menuitem" data-destination="${dest}">上传至${dest}</button>`).join('');wrap.append(menu);menu.querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();wrap.classList.remove('menu-open');uploadQuestions(b.dataset.destination,saveCurrent);});wrap.onkeydown=e=>{if(e.key==='Escape'){wrap.classList.remove('menu-open');wrap.classList.add('menu-dismissed');button.focus();}};wrap.onmouseenter=()=>wrap.classList.remove('menu-dismissed');wrap.addEventListener('pointerdown',()=>wrap.classList.remove('menu-dismissed'));button.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')wrap.classList.remove('menu-dismissed');});return wrap;}
const topUpload=createUploadMenu($('#topAction'),false),lastUpload=createUploadMenu($('#nextAi'),true);
$('#topAction').addEventListener('click',e=>{if(state.step!==2)return;e.stopImmediatePropagation();topUpload.classList.toggle('menu-open');},true);
$('#nextAi').addEventListener('click',e=>{if(state.questions.at(-1)?.id!==state.activeQuestionId)return;e.stopImmediatePropagation();lastUpload.classList.toggle('menu-open');},true);
const uploadMenuSync=new MutationObserver(()=>{topUpload.classList.toggle('upload-enabled',state.step===2);lastUpload.classList.toggle('upload-enabled',state.step===2&&state.questions.at(-1)?.id===state.activeQuestionId);if(state.step===1)topUpload.classList.remove('menu-open');});uploadMenuSync.observe($('#workbenchPage'),{subtree:true,childList:true});
document.addEventListener('pointerdown',e=>{$$('.upload-destination').forEach(w=>{if(!w.contains(e.target))w.classList.remove('menu-open');});});
renderMonitor();
const openRecordBeforeAiPage=openRecord;
openRecord=function(id){aiPage.classList.add('hidden');openRecordBeforeAiPage(id);};

// Configure PAPER_AI_RECOGNIZE_URL to a server endpoint returning {text:string}.
// Images are sent in the order shown; service errors never fall back to demo data.
async function recognizeCaptureBatch(c){
 if(sourceCapture!==c||c.busy||!c.items.length||c.items.length>6)return;
 c.busy=true;c.result=null;const button=$('#recognizeCaptureImages');button.disabled=true;button.textContent='AI识别中…';$('#applyCaptureImages').disabled=true;$('#captureRecognitionResult').classList.add('hidden');c.overlay.style.pointerEvents='none';$$('#captureThumbnails button').forEach(b=>b.disabled=true);
 const controller=new AbortController();c.abortController=controller;const timeout=setTimeout(()=>controller.abort(),45000);
 try{
  const images=c.items.map(item=>item.url);let result;
  if(window.PAPER_AI_RECOGNIZE_URL){const response=await fetch(window.PAPER_AI_RECOGNIZE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,structure:{count:currentQuestion().count,display:currentQuestion().display,parts:currentQuestion().parts?.map(p=>({display:p.display}))}}),signal:controller.signal});if(!response.ok)throw Error(`AI识别请求失败（${response.status}）`);const payload=await response.json();const text=payload.text||payload.question?.publicStem||payload.question?.stem;if(typeof text!=='string'||!text.trim())throw Error('AI识别未返回有效题干，请重试');result={text,question:payload.question,mode:'service'};}
  else{await new Promise(resolve=>setTimeout(resolve,800));const stem=currentQuestion().stem;result={text:stem&&!stem.startsWith('（')?stem:'请核对并填写识别出的题干。',mode:'demo'};}
  if(sourceCapture!==c||c.taskId!==state.activeTaskId||c.questionId!==currentQuestion().id)return;
  c.result=result;$('#captureRecognitionText').value=result.text;$('#captureRecognitionLabel').textContent=result.mode==='demo'?'演示识别结果（真实AI接口待接入，请核对）':'AI识别结果（请核对）';$('#captureRecognitionResult').classList.remove('hidden');$('#applyCaptureImages').disabled=false;
 }catch(error){if(sourceCapture===c)toast(error.name==='AbortError'?'AI识别超时，请重试':error.message);}
 finally{clearTimeout(timeout);if(sourceCapture===c){c.busy=false;c.overlay.style.pointerEvents='';button.disabled=false;button.textContent='AI重新识别';$$('#captureThumbnails button').forEach(b=>{b.disabled=b.dataset.shotUp==='0'||Number(b.dataset.shotDown)===c.items.length-1;});}}
}
const cancelCaptureBeforeAiAbort=cancelSourceCapture;
cancelSourceCapture=function(){sourceCapture?.abortController?.abort();cancelCaptureBeforeAiAbort();};
