/* Iron Log platform modules: nutrition, recovery, body tracking and evidence-led insights. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const read = (key, fallback={}) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) { console.error('Local storage write failed',e); toast('Storage is full. Export or remove old data before continuing.'); } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = msg => { if(typeof window.showToast==='function') window.showToast(msg); else console.info(msg); };
  const dbKey = {nutrition:'ironlog_nutrition_v1', recovery:'ironlog_recovery_v1', body:'ironlog_body_measurements_v1', targets:'ironlog_nutrition_targets_v1'};
  let nutrition=read(dbKey.nutrition), recovery=read(dbKey.recovery), body=read(dbKey.body), targets=read(dbKey.targets,{calories:2200,protein:130});
  const foods = [
    {id:'idli',name:'Idli (2 medium)',kcal:140,p:4,c:29,f:1,unit:'2 idli',confidence:'Estimated'},
    {id:'dosa',name:'Plain dosa (1 medium)',kcal:168,p:4,c:28,f:4,unit:'1 dosa',confidence:'Estimated'},
    {id:'sambar',name:'Sambar (1 cup)',kcal:110,p:6,c:16,f:2,unit:'1 cup',confidence:'Estimated'},
    {id:'rice',name:'Cooked rice (1 cup)',kcal:205,p:4.3,c:45,f:.4,unit:'1 cup',confidence:'Estimated'},
    {id:'dal',name:'Cooked dal (1 cup)',kcal:230,p:18,c:40,f:1,unit:'1 cup',confidence:'Estimated'},
    {id:'roti',name:'Whole-wheat roti (1)',kcal:110,p:3.5,c:22,f:1.5,unit:'1 roti',confidence:'Estimated'},
    {id:'paneer',name:'Paneer (100 g)',kcal:265,p:18,c:4,f:20,unit:'100 g',confidence:'Estimated'},
    {id:'curd',name:'Plain curd (1 cup)',kcal:150,p:8,c:11,f:8,punit:'1 cup',confidence:'Estimated'},
    {id:'egg',name:'Egg (1 large)',kcal:72,p:6.3,c:.4,f:4.8,unit:'1 egg',confidence:'Estimated'},
    {id:'chicken',name:'Cooked chicken breast (100 g)',kcal:165,p:31,c:0,f:3.6,unit:'100 g',confidence:'Estimated'},
    {id:'banana',name:'Banana (1 medium)',kcal:105,p:1.3,c:27,f:.4,unit:'1 banana',confidence:'Estimated'},
    {id:'oats',name:'Oats (40 g dry)',kcal:152,p:5.3,c:27,f:2.7,unit:'40 g',confidence:'Estimated'},
    {id:'whey',name:'Whey protein (1 scoop)',kcal:120,p:24,c:3,f:1.5,unit:'1 scoop',confidence:'Label-dependent estimate'},
    {id:'almonds',name:'Almonds (20 g)',kcal:116,p:4.2,c:4.3,f:10,unit:'20 g',confidence:'Estimated'}
  ];
  const dayRows = (obj, date=today()) => Array.isArray(obj[date]) ? obj[date] : [];
  const totals = rows => rows.reduce((a,r)=>({calories:a.calories+r.kcal,protein:a.protein+r.p,carbs:a.carbs+r.c,fat:a.fat+r.f}),{calories:0,protein:0,carbs:0,fat:0});
  let cloudTimer;
  async function cloudSave(id,data){
    write(dbKey[id],data);
    write('ironlog_platform_pending_v1',{...(read('ironlog_platform_pending_v1')),[id]:data});
    clearTimeout(cloudTimer);
    cloudTimer=setTimeout(flushPending,500);
  }
  const moduleCollections = {nutrition:'nutritionDays',recovery:'recoveryDays',body:'bodyMeasurementDays'};
  async function cloudLoad(){
    const user=window.firebase?.auth?.().currentUser;if(!user)return;
    const userRef=firebase.firestore().collection('users').doc(user.uid), pending=read('ironlog_platform_pending_v1');
    for(const id of ['nutrition','recovery','body','targets']){
      if(pending[id]) continue;
      try{
        if(id==='targets'){
          const snap=await userRef.collection('fitnessModules').doc('targets').get();
          if(snap.exists&&snap.data().data){targets=snap.data().data;write(dbKey.targets,targets);}else cloudSave('targets',targets);
          continue;
        }
        const collection=moduleCollections[id], snap=await userRef.collection(collection).get();
        if(!snap.empty){const data={};snap.docs.forEach(doc=>{const row=doc.data();if(id==='nutrition'){data[doc.id]=row.entries||[];if(row.waterMl!=null){data.water=data.water||{};data.water[doc.id]=row.waterMl;}}else data[doc.id]=row.data||{};});
          // Preserve device-only/offline records. Cloud values win for matching IDs/dates.
          if(id==='nutrition'){const local=nutrition,merged={...local,...data,water:{...(local.water||{}),...(data.water||{})}};let hasLocalOnly=false;for(const date of Object.keys(data)){if(date==='water')continue;const localRows=Array.isArray(local[date])?local[date]:[],cloudRows=Array.isArray(data[date])?data[date]:[],cloudIds=new Set(cloudRows.map(x=>x.id));if(localRows.some(x=>!cloudIds.has(x.id)))hasLocalOnly=true;const byId=new Map(localRows.map(x=>[x.id,x]));cloudRows.forEach(x=>byId.set(x.id,x));merged[date]=[...byId.values()];}if(Object.keys(local).some(k=>k!=='water'&&!Object.prototype.hasOwnProperty.call(data,k))||(local.water&&Object.keys(local.water).some(k=>!Object.prototype.hasOwnProperty.call(data.water||{},k))))hasLocalOnly=true;nutrition=merged;write(dbKey[id],nutrition);if(hasLocalOnly)cloudSave(id,nutrition);}
          if(id==='recovery'){const local=recovery,merged={...local,...data};for(const date of Object.keys(data))if(local[date]&&data[date])merged[date]={...local[date],...data[date]};const hasLocalOnly=Object.keys(local).some(k=>!Object.prototype.hasOwnProperty.call(data,k)||Object.keys(local[k]||{}).some(field=>!Object.prototype.hasOwnProperty.call(data[k]||{},field)));recovery=merged;write(dbKey[id],recovery);if(hasLocalOnly)cloudSave(id,recovery);}
          if(id==='body'){const local=body,merged={...local,...data};for(const date of Object.keys(data))if(local[date]&&data[date])merged[date]={...local[date],...data[date]};const hasLocalOnly=Object.keys(local).some(k=>!Object.prototype.hasOwnProperty.call(data,k)||Object.keys(local[k]||{}).some(field=>!Object.prototype.hasOwnProperty.call(data[k]||{},field)));body=merged;write(dbKey[id],body);if(hasLocalOnly)cloudSave(id,body);}
        }
        if(snap.empty){
          // One-time backward-compatible import from the earlier single-document layout.
          const legacy=await userRef.collection('fitnessModules').doc(id).get();
          if(legacy.exists&&legacy.data().data){const data=legacy.data().data;if(id==='nutrition')nutrition={...nutrition,...data};if(id==='recovery')recovery={...recovery,...data};if(id==='body')body={...body,...data};write(dbKey[id],id==='nutrition'?nutrition:id==='recovery'?recovery:body);await cloudSave(id,id==='nutrition'?nutrition:id==='recovery'?recovery:body);}
          else {const localData=id==='nutrition'?nutrition:id==='recovery'?recovery:body;if(Object.keys(localData||{}).length)cloudSave(id,localData);}
        }
      }catch(e){console.warn('Using local '+id+' data',e);}
    }
    renderAllModules(); await flushPending();
  }
  async function flushPending(){
    const user=window.firebase?.auth?.().currentUser;if(!user||!navigator.onLine)return;
    const userRef=firebase.firestore().collection('users').doc(user.uid), pending=read('ironlog_platform_pending_v1');
    for(const [id,data] of Object.entries(pending)){
      try{
        if(id==='targets') await userRef.collection('fitnessModules').doc('targets').set({data,updatedAt:new Date().toISOString(),schemaVersion:2},{merge:true});
        else {
          const collection=moduleCollections[id]; if(!collection) continue;
          const dates=[...new Set([...Object.keys(data||{}),...Object.keys(data?.water||{})])].filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k));
          await Promise.all(dates.map(date=>{const payload=id==='nutrition'?{entries:Array.isArray(data[date])?data[date]:[],waterMl:Number(data.water?.[date]||0)}:{data:data[date]};return userRef.collection(collection).doc(date).set({...payload,updatedAt:new Date().toISOString(),schemaVersion:2},{merge:true});}));
          // Remove the legacy aggregate only after every date document has been written.
          await userRef.collection('fitnessModules').doc(id).delete().catch(()=>{});
        }
        delete pending[id];
      }catch(e){console.warn('Pending module sync remains queued',id,e);}
    }
    write('ironlog_platform_pending_v1',pending);
  }
  function stat(label,value,unit=''){return `<div class="module-stat"><strong>${esc(value)}${unit}</strong><span>${esc(label)}</span></div>`;}
  function renderNutrition(){
    const rows=dayRows(nutrition), t=totals(rows), water=window.IronLogAPI?.getWaterMl ? window.IronLogAPI.getWaterMl() : Number((nutrition.water||{})[today()]||0), waterTarget=window.IronLogAPI?.getWaterTargetMl ? window.IronLogAPI.getWaterTargetMl() : 2500;
    $('nutritionSummary').innerHTML=stat('Calories',Math.round(t.calories),' kcal')+stat('Protein',t.protein.toFixed(0),' g')+stat('Water',`${water.toLocaleString()} / ${waterTarget.toLocaleString()}`,' ml');
    $('macroSummary').textContent=`Macros logged: ${t.carbs.toFixed(0)} g carbohydrates · ${t.fat.toFixed(0)} g fat. Food values are estimates.`;
    $('nutritionDate').textContent=new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
    const list=$('mealLogList');
    list.innerHTML=rows.length?rows.map((r,i)=>`<div class="module-row"><div><strong>${esc(r.name)}</strong><div class="module-muted">${esc(r.meal)} · ${r.serving} serving · ${Math.round(r.kcal)} kcal · ${r.p.toFixed(1)} g protein</div></div><button class="module-delete" data-food-delete="${i}" aria-label="Remove ${esc(r.name)}">Remove</button></div>`).join(''):'<div class="module-empty">No meals logged today. Add your first meal above.</div>';
    const calPct=Math.min(100,t.calories/Math.max(1,targets.calories)*100), proteinPct=Math.min(100,t.protein/Math.max(1,targets.protein)*100);
    list.insertAdjacentHTML('beforeend',`<div class="module-row"><div style="width:100%"><strong>Calories target · ${Math.round(t.calories)} / ${targets.calories} kcal</strong><div class="module-progress"><i style="width:${calPct}%"></i></div><div class="module-muted">Protein · ${t.protein.toFixed(0)} / ${targets.protein} g</div><div class="module-progress"><i style="width:${proteinPct}%"></i></div></div></div>`);
    $('calorieTarget').value=targets.calories;$('proteinTarget').value=targets.protein;
  }
  function renderRecovery(){
    const row=recovery[today()];
    if(row){const score=Math.round(Math.max(0,Math.min(100,(row.sleep/8*35)+(row.energy/5*25)+((6-row.soreness)/5*25)+((6-row.stress)/5*15))));$('readinessBadge').textContent=`${score}/100 · ${score>=75?'Good':score>=55?'Moderate':'Low'}`;$('readinessResult').textContent=`Self-reported readiness: ${score}/100. Use this as a conservative training signal, not a diagnosis. If soreness or fatigue is high, reduce load or take a rest day.`;$('recoverySleep').value=row.sleep;$('recoveryEnergy').value=row.energy;$('recoverySoreness').value=row.soreness;$('recoveryStress').value=row.stress;$('recoveryNotes').value=row.notes||'';}
    else{$('readinessBadge').textContent='Not logged';$('readinessResult').textContent='Log sleep, energy, soreness and stress to generate a simple readiness estimate.';}
    const keys=Object.keys(recovery).sort().reverse().slice(0,7);$('recoveryHistory').innerHTML=keys.length?keys.map(k=>{const r=recovery[k];return `<div class="module-row"><div><strong>${esc(k)}</strong><div class="module-muted">Sleep ${r.sleep}h · Energy ${r.energy}/5 · Soreness ${r.soreness}/5 · Stress ${r.stress}/5</div></div></div>`}).join(''):'<div class="module-empty">No recovery check-ins yet.</div>';
  }
  function renderBody(){
    $('bodyDate').value=today();const keys=Object.keys(body).sort().reverse().slice(0,30);
    $('bodyHistory').innerHTML=keys.length?keys.map(k=>{const r=body[k];return `<div class="module-row"><div><strong>${esc(k)}${r.weight?` · ${r.weight} kg`:''}</strong><div class="module-muted">${[['Waist',r.waist],['Chest',r.chest],['Arm',r.arm],['Thigh',r.thigh]].filter(x=>x[1]).map(x=>`${x[0]} ${x[1]} cm`).join(' · ')||'No circumference measurements'}</div></div></div>`}).join(''):'<div class="module-empty">No measurements recorded. Add an optional entry above.</div>';
  }
  function intelligence(){
    const logs=read('ironlog_logs'), dates=Object.keys(logs||{}).sort().reverse(), week=dates.filter(d=>{const age=Date.now()-new Date(d+'T12:00:00').getTime();return age>=0&&age<7*86400000;}), meals=dayRows(nutrition), rec=recovery[today()];
    const legacyDays=week.filter(d=>window.IronLogAPI?.hasWorkout?window.IronLogAPI.hasWorkout(d):logs[d]&&Object.keys(logs[d]).length);const advancedDays=(window.IronLogAdvanced?.getSessions?.()||[]).map(s=>s.date).filter(d=>week.includes(d));const workoutDays=new Set([...legacyDays,...advancedDays]).size, food=totals(meals);
    const actions=[];if(!workoutDays)actions.push(['Start with a realistic training baseline','No completed sessions were detected in the last 7 days. Log workouts consistently before increasing volume.']);else if(workoutDays>=6)actions.push(['Review training frequency',`${workoutDays} logged training days in the last 7 days. Check recovery and performance before adding more sessions.`]);else actions.push(['Keep training consistent',`${workoutDays} training days detected in the last 7 days. Progress gradually and track completed sets.`]);
    if(!rec)actions.push(['Complete a recovery check-in','Sleep, energy, soreness and stress are missing for today. The system will not assume you are fully recovered.']);else if(rec.soreness>=4||rec.energy<=2||rec.sleep<5)actions.push(['Consider a lighter session',`Your check-in reports ${rec.sleep} hours sleep, energy ${rec.energy}/5 and soreness ${rec.soreness}/5. Consider reducing intensity if performance feels impaired.`]);
    if(!meals.length)actions.push(['Log nutrition for better guidance','No meals are logged today. Nutrition recommendations remain unavailable until food intake is recorded.']);else if(food.protein<targets.protein*.5)actions.push(['Review protein intake',`Logged protein is ${food.protein.toFixed(0)} g so far against a ${targets.protein} g target. This is a partial-day comparison, not a full-day conclusion.`]);
    $('intelligenceSummary').innerHTML=stat('Training days · 7d',workoutDays)+stat('Meals · today',meals.length)+stat('Data coverage',`${[workoutDays>0,meals.length>0,!!rec].filter(Boolean).length}/3`);
    $('intelligenceActions').innerHTML=actions.map((a,i)=>`<div class="module-action"><strong>${i+1}. ${esc(a[0])}</strong><p>${esc(a[1])}</p></div>`).join('');
    $('intelligenceQuality').textContent=`Training: ${workoutDays?'some workout records found':'missing or no recent sessions'}. Nutrition: ${meals.length?'partial-day food log':'missing'}. Recovery: ${rec?'self-reported check-in available':'missing'}. These insights use simple deterministic rules and user-entered data; food macros are estimates, and readiness is not a medical measure. No external AI or medical diagnosis is used.`;
  }
  function renderAllModules(){renderNutrition();renderRecovery();renderBody();intelligence();}
  function bind(){
    const select=$('foodPreset');if(!select)return;
    select.innerHTML+='<optgroup label="Common foods">'+foods.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')+'</optgroup>';
    const updateEstimate=()=>{const f=foods.find(x=>x.id===select.value),n=Math.max(.25,Number($('foodServing').value)||1);$('foodEstimate').textContent=f?`Approx. ${Math.round(f.kcal*n)} kcal · ${(f.p*n).toFixed(1)} g protein · ${f.confidence}. Actual values vary by recipe, portion and brand.`:'';};
    select.addEventListener('change',updateEstimate);$('foodServing').addEventListener('input',updateEstimate);
    $('addFoodBtn').onclick=()=>{const f=foods.find(x=>x.id===select.value),n=Number($('foodServing').value);if(!f||!Number.isFinite(n)||n<=0||n>20){toast('Choose a food and valid serving');return;}nutrition[today()]=dayRows(nutrition).concat([{id:crypto.randomUUID?.()||String(Date.now()),name:f.name,meal:$('mealType').value,serving:n,kcal:f.kcal*n,p:f.p*n,c:f.c*n,f:f.f*n,confidence:f.confidence,createdAt:new Date().toISOString()}]);cloudSave('nutrition',nutrition);renderNutrition();toast('Meal added');};
    $('mealLogList').addEventListener('click',e=>{const b=e.target.closest('[data-food-delete]');if(!b)return;const i=Number(b.dataset.foodDelete);nutrition[today()]=dayRows(nutrition).filter((_,j)=>j!==i);cloudSave('nutrition',nutrition);renderNutrition();});
    $('addWater250').onclick=()=>addWater(250);$('addWater500').onclick=()=>addWater(500);
    $('saveNutritionTargets').onclick=()=>{targets={calories:clamp($('calorieTarget').value,500,7000,2200),protein:clamp($('proteinTarget').value,20,400,130)};cloudSave('targets',targets);renderNutrition();toast('Targets saved');};
    $('saveRecovery').onclick=()=>{const sleep=clamp($('recoverySleep').value,0,24,7),energy=clamp($('recoveryEnergy').value,1,5,3),soreness=clamp($('recoverySoreness').value,1,5,2),stress=clamp($('recoveryStress').value,1,5,3);recovery[today()]={sleep,energy,soreness,stress,notes:$('recoveryNotes').value.slice(0,500),updatedAt:new Date().toISOString()};cloudSave('recovery',recovery);renderRecovery();intelligence();toast('Recovery check-in saved');};
    $('saveBodyMeasurement').onclick=()=>{const date=$('bodyDate').value||today(),entry={};[['weight','bodyWeight',20,400],['waist','bodyWaist',20,250],['chest','bodyChest',20,250],['arm','bodyArm',5,100],['thigh','bodyThigh',10,150]].forEach(([k,id,min,max])=>{const v=$(id).value;if(v!==''){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max){entry._invalid=true;return;}entry[k]=Math.round(n*10)/10;}});if(entry._invalid){toast('One or more measurements are outside the allowed range');return;}if(!Object.keys(entry).length){toast('Enter at least one measurement');return;}body[date]={...(body[date]||{}),...entry,updatedAt:new Date().toISOString()};cloudSave('body',body);if(entry.weight){if(window.IronLogAPI?.updateWeightLog)window.IronLogAPI.updateWeightLog(date,entry.weight);else{const wl=read('ironlog_weightlog');wl[date]=entry.weight;write('ironlog_weightlog',wl);}}renderBody();toast('Measurement saved');};
    $('refreshIntelligence').onclick=intelligence;
    const theme=read('ironlog_theme','dark');document.documentElement.setAttribute('data-theme',theme);$('themeToggle').textContent=theme==='dark'?'Switch to light':'Switch to dark';$('themeToggle').onclick=()=>{const next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);write('ironlog_theme',next);$('themeToggle').textContent=next==='dark'?'Switch to light':'Switch to dark';};
    const exportBtn=document.createElement('button');exportBtn.className='finish-btn outline';exportBtn.textContent='Export all Iron Log data';exportBtn.style.marginTop='12px';exportBtn.onclick=exportBackup;$('intelligenceQuality').parentElement.appendChild(exportBtn);
    let timerId=null,remaining=90;const paintTimer=()=>{$('restTimerDisplay').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;};
    if($('restTimerStart')){$('restTimerStart').onclick=()=>{if(timerId)return;$('restTimerStatus').textContent='Running';timerId=setInterval(()=>{remaining--;paintTimer();if(remaining<=0){clearInterval(timerId);timerId=null;$('restTimerStatus').textContent='Complete';try{if('vibrate'in navigator)navigator.vibrate([180,80,180]);}catch{}}},1000);};$('restTimerStop').onclick=()=>{clearInterval(timerId);timerId=null;$('restTimerStatus').textContent='Paused';};$('restTimerReset').onclick=()=>{clearInterval(timerId);timerId=null;remaining=90;paintTimer();$('restTimerStatus').textContent='Ready';};paintTimer();}

    window.addEventListener('online',flushPending);
    window.addEventListener('ironlog:nutrition-updated',()=>{nutrition=read(dbKey.nutrition);cloudSave('nutrition',nutrition);renderNutrition();intelligence();});
    document.querySelectorAll('.tab[data-view]').forEach(tab=>tab.addEventListener('click',()=>{if(['nutrition','recovery','body','intelligence'].includes(tab.dataset.view)){if(tab.dataset.view==='nutrition')renderNutrition();if(tab.dataset.view==='recovery')renderRecovery();if(tab.dataset.view==='body')renderBody();if(tab.dataset.view==='intelligence')intelligence();}}));
    renderAllModules();
    // Auth callback can fire before this extension is loaded; retry once after app init.
    setTimeout(cloudLoad,1200);
    if(window.firebase?.auth)firebase.auth().onAuthStateChanged(user=>{if(user)cloudLoad();});
    window.addEventListener('focus',()=>{if(navigator.onLine)cloudLoad();});
  }
  function addWater(amount){if(window.IronLogAPI?.logWater){window.IronLogAPI.logWater(amount);renderNutrition();}else{nutrition.water=nutrition.water||{};nutrition.water[today()]=Number(nutrition.water[today()]||0)+amount;cloudSave('nutrition',nutrition);renderNutrition();}toast(`${amount} ml water logged`);}
  function exportBackup(){
    const payload={app:'Iron Log',schemaVersion:1,exportedAt:new Date().toISOString(),data:{}};
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith('ironlog_'))payload.data[key]=localStorage.getItem(key);}
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`iron-log-backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup exported');
  }
  function clamp(value,min,max,fallback){const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
