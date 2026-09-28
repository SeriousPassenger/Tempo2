
import {TempoStorage} from './storage.mjs';
import {importProfile} from './engine.mjs';
const storage = new TempoStorage();
const $=s=>document.querySelector(s);
const icons={
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 tally:'<path d="M5 4v16M10 4v16M15 4v16M20 4v16M2 17L22 7"/>',
 timer:'<circle cx="12" cy="14" r="8"/><path d="M12 10v4l3 2M9 2h6M12 2v4M18 5l2 2"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
 archive:'<path d="M4 9v11h16V9M9 13h6"/><rect x="2" y="3" width="20" height="6" rx="1"/>',
 settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--panel)"/><circle cx="16" cy="12" r="2" fill="var(--panel)"/><circle cx="10" cy="18" r="2" fill="var(--panel)"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
 moon:'<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
 check:'<path d="m5 12 4 4L19 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 play:'<path d="m8 4 12 8-12 8Z"/>',pause:'<path d="M8 4v16M16 4v16"/>',
 undo:'<path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12h-2"/>',
 history:'<path d="M3 10a9 9 0 1 1 0 5M3 4v6h6M12 7v5l3 2"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/>',
 leaf:'<path d="M20 3C7 2 2 7 5 16s17 5 15-13ZM5 20 15 10"/>',
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
 screen:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
 trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
};
function icon(name){return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.grid}</svg>`;}
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
const pad=n=>String(n).padStart(2,'0');
const themes=['midnight','paper','forest','sage','violet','rose'];
const pairs={midnight:'paper',paper:'midnight',forest:'sage',sage:'forest',violet:'rose',rose:'violet'};
let state=null,filter='all',signature='',syncTime=performance.now(),serverTime=Date.now()/1000,fetching=null,online=false;
let editId=null,entryId=null,historyId=null,confirmJob=null,selectedColor='amber',toastTimer=null;
let rolloverPending=false,actionQueue=Promise.resolve();
const now=()=>serverTime+(performance.now()-syncTime)/1000;
const byId=id=>state?.trackers.find(t=>t.id===id);
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
function applyTheme(theme){if(!themes.includes(theme))return;document.documentElement.dataset.theme=theme;$('#theme-select').value=theme;$('#mode-toggle').innerHTML=icon(['paper','sage','rose'].includes(theme)?'moon':'sun');}
applyTheme('midnight');
let profileId=null,profileList=[],renameProfile=false,importCandidate=null,importRevision=null,profileSwitching=false;
const selectedKey=storage.name+':selected';
try{profileId=sessionStorage.getItem(selectedKey);}catch{}
function rememberProfile(){try{sessionStorage.setItem(selectedKey,profileId);}catch{}}
function connection(ok,error=''){
 online=ok;$('#offline-notice').hidden=ok;$('#connection').classList.toggle('offline',!ok);
 $('#connection span').textContent=ok?'Saved in this browser':'Storage unavailable';
 if(!ok)$('#offline-notice>span').textContent=error||'Local storage is unavailable. Enable site storage, then retry.';
}
async function refresh(){
 if(fetching)return fetching;
 fetching=(async()=>{try{
  await storage.open();profileList=await storage.list();
  if(!profileList.some(p=>p.id===profileId)){profileId=profileList[0]?.id;rememberProfile();}
  if(!profileId)throw new Error('Create a profile to begin.');
  const currentId=profileId,s=await storage.state(currentId);
  if(currentId!==profileId)return false;
  state=s;serverTime=s.now;syncTime=performance.now();connection(true);applyTheme(s.theme);
  const selector=$('#profile-select');const options=profileList.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if(selector.innerHTML!==options)selector.innerHTML=options;selector.value=profileId;
  const next=JSON.stringify([s.trackers,s.day,s.logged_today,s.profile,filter]);
  if(next!==signature){signature=next;render();}tick();return true;
 }catch(err){connection(false,err.message);return false;}finally{fetching=null;rolloverPending=false;}})();
 return fetching;
}
function mutate(data){
 if(profileSwitching)return Promise.reject(new Error('Wait for the profile switch to finish.'));
 const key=crypto.randomUUID().replaceAll('-',''),targetProfile=profileId;
 const task=async()=>{
  if(!online)throw new Error('Wait for local storage to finish loading.');
  const result=await storage.mutate(targetProfile,data,key);
  if(fetching)await fetching;
  await refresh();return result;
 };
 const job=actionQueue.then(task);actionQueue=job.catch(()=>{});return job;
}
async function switchProfile(id){
 if(profileSwitching)return;
 profileSwitching=true;
 try{await actionQueue;if(fetching)await fetching;profileId=id;rememberProfile();signature='';state=null;
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());await refresh();
 }finally{profileSwitching=false;}
}
function secondsText(value){let s=Math.max(0,Math.floor(value));const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return `${pad(h)}:${pad(m)}:${pad(s%60)}`;}
function durationText(value){if(value>=86400)return `${fmt(value/86400)} days`;if(value>=3600)return `${fmt(value/3600)} hours`;if(value>=60)return `${fmt(value/60)} min`;return `${fmt(value)} sec`;}
function elapsedValue(t,time=now()){const start=t.cadence==='daily'?Math.max(t.running_since??time,state.day_start):t.running_since??time;return t.value+(t.running_since!==null?Math.max(0,time-start):0);}
function countdownParts(s){s=Math.max(0,Math.floor(s));return {d:Math.floor(s/86400),h:Math.floor(s%86400/3600),m:Math.floor(s%3600/60),s:s%60};}
function timeMarkup(){return '<div class="countdown-numbers"><span class="days"><b data-part="d">0</b><small>d</small></span><span><b data-part="h">00</b><small>h</small></span><span><b data-part="m">00</b><small>m</small></span><span><b data-part="s">00</b><small>s</small></span></div>';}
function tallyMarkup(value){let n=Math.floor(value),html='';for(let j=0;j<Math.min(n,30);j+=5){let paths='';for(let k=0;k<Math.min(4,n-j);k++)paths+=`<path d="M${4+k*6} 3v15"/>`;if(n-j>=5)paths+='<path d="M1 16 27 5"/>';html+=`<svg class="tally" viewBox="0 0 30 21" aria-hidden="true">${paths}</svg>`;}if(n>30)html+=`<small>+${fmt(n-30)} more</small>`;return html||'<small>No entries yet. A fresh start.</small>';}
function cardMarkup(t){
 const timed=['countdown','streak'].includes(t.kind),ic={counter:'tally',timer:'timer',countdown:'calendar',streak:'leaf'}[t.kind];
 const subtitle=t.kind==='countdown'?'EVENT COUNTDOWN':t.kind==='streak'?'TIME SINCE · MILESTONE':`${t.cadence==='daily'?'DAILY':'ONGOING'} ${t.direction==='limit'?'LIMIT':'GOAL'}`;
 const timeMain=timed?timeMarkup():`<div><div class="metric ${t.kind==='timer'?'timer':''}" data-metric></div><div class="metric-sub" data-sub></div>${t.kind==='counter'?`<div class="tallies" aria-label="${esc(fmt(t.value))} tally marks">${tallyMarkup(t.value)}</div>`:''}</div><div class="ring" aria-hidden="true"><svg viewBox="0 0 84 84"><circle class="track" cx="42" cy="42" r="36"/><circle class="fill" cx="42" cy="42" r="36"/></svg><span data-percent>0%</span></div>`;
 let actions;
 if(t.archived){actions=`<button class="button secondary" data-action="archive">${icon('undo')}Restore tracker</button><button class="icon-button" data-action="delete" title="Permanently delete" aria-label="Permanently delete ${esc(t.title)}">${icon('trash')}</button>`;}
 else if(t.kind==='counter'){actions=`<button class="button action" data-action="quick" data-primary>${icon('plus')}<span data-button-label>Log ${fmt(t.step)}</span></button><button class="icon-button" data-action="entry" title="Custom amount" aria-label="Log custom amount">${icon('edit')}</button><button class="icon-button" data-action="undo" ${t.can_undo?'':'disabled'} title="Undo last entry" aria-label="Undo last entry">${icon('undo')}</button>`;}
 else if(t.kind==='timer'){actions=`<button class="button action" data-action="${t.running_since===null?'start':'pause'}" data-primary>${icon(t.running_since===null?'play':'pause')}<span>${t.running_since===null?'Start session':'Pause session'}</span></button><button class="button secondary" data-action="entry">${icon('plus')}Log time</button>`;}
 else if(t.kind==='streak'){actions=`<button class="button action" data-action="history">${icon('history')}View journey</button><button class="button secondary" data-action="reset">${icon('undo')}Restart</button>`;}
 else {actions=`<button class="button action" data-action="edit">${icon('calendar')}Edit event</button><button class="button secondary" data-action="archive">${icon('archive')}Archive</button>`;}
 return `<article class="card ${timed?'time-card':''} ${t.archived?'archived':''}" data-id="${t.id}" data-color="${esc(t.color)}"><div class="card-head"><div class="type-icon">${icon(ic)}</div><div class="card-title"><h3>${esc(t.title)}</h3><p>${subtitle}</p></div><button class="mini" data-action="edit" title="Edit tracker" aria-label="Edit ${esc(t.title)}">${icon('edit')}</button><button class="mini" data-action="history" title="History and archive" aria-label="History for ${esc(t.title)}">${icon('history')}</button></div><div class="card-main">${timeMain}${timed?'<div class="metric-sub" data-sub></div>':''}</div><div class="progress-line" role="progressbar" aria-label="${esc(t.title)} progress" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="card-meta"><span data-meta-left></span><span data-meta-right></span></div>${t.note?`<div class="card-note">${esc(t.note)}</div>`:''}<div class="card-footer">${actions}</div></article>`;
}
function render(){
 if(!state)return;
 const active=state.trackers.filter(t=>!t.archived),visible=state.trackers.filter(t=>filter==='archive'?t.archived:!t.archived&&(filter==='all'||(filter==='dates'?['countdown','streak'].includes(t.kind):t.kind===filter)));
 $('#nav-count').textContent=active.length;$('#stat-active').textContent=active.length;$('#stat-logged').textContent=state.logged_today;$('#stat-running').textContent=active.filter(t=>t.running_since!==null).length;
 const names={all:'Your trackers',counter:'Count what matters',timer:'Make time for it',dates:'Days with meaning',archive:'Your archive'};
 $('#section-title').textContent=names[filter];$('#section-description').textContent=filter==='archive'?'Your history stays here, whenever you need it.':'Every small action counts.';
 document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-current',b.dataset.filter===filter?'page':'false');});
 $('#tracker-grid').innerHTML=visible.length?visible.map(cardMarkup).join(''):`<div class="empty"><div class="empty-icon">${icon(filter==='archive'?'archive':'spark')}</div><h3>${filter==='archive'?'Nothing archived yet.':'Your next small win starts here.'}</h3><p>${filter==='archive'?'Archive a tracker from its History panel to keep its data for later.':'Set a daily limit, build a habit, or count down to something good. Your first tracker takes just a moment.'}</p>${filter==='archive'?'':'<button class="button primary" data-action="new">'+icon('plus')+'Create your first tracker</button>'}</div>`;
 $('#profile-summary').textContent=state.profile.name+' · '+state.trackers.length+' trackers · stored in this browser';$('#version').textContent=state.version;$('#clock-zone').textContent=state.timezone||'LOCAL TIME';
 tick();
}
function tick(){
 const time=now(),date=new Date(time*1000);$('#local-clock').textContent=date.toLocaleTimeString(undefined,{hour12:false});$('#orbit-dot').style.transform=`rotate(${date.getSeconds()*6}deg)`;
 $('#today-label').textContent=date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
 if(!state)return;
 if(time>=state.day_end&&online&&!rolloverPending){rolloverPending=true;void refresh();}
 $('#day-note').textContent=`Daily reset in ${secondsText(state.day_end-time)} · ${state.timezone||'computer local time'}`;
 document.querySelectorAll('.card[data-id]').forEach(card=>{
  const t=byId(card.dataset.id);if(!t)return;
  let value,ratio,sub,left,right;
  if(t.kind==='counter'||t.kind==='timer'){
   value=elapsedValue(t,time);const leftValue=Math.max(0,t.goal-value),over=Math.max(0,value-t.goal),limit=t.direction==='limit';ratio=limit?leftValue/t.goal:value/t.goal;
   const metric=card.querySelector('[data-metric]');
   if(t.kind==='counter'){const display=fmt(limit?leftValue:value);metric.innerHTML=`${display}<small>${limit?'left':'done'}</small>`;metric.style.fontSize=display.length>9?'23px':display.length>6?'30px':'';sub=`${fmt(value)} of ${fmt(t.goal)} ${t.unit} ${limit?'used':'completed'}`;const button=card.querySelector('[data-action=quick]');if(button){const amount=Math.min(t.step,leftValue);button.disabled=!online||(limit&&amount<1);button.querySelector('[data-button-label]').textContent=limit&&leftValue<1?'Limit reached':`Log ${fmt(limit?amount:t.step)}`;}}
   else{metric.textContent=secondsText(limit?leftValue:value);sub=over&&limit?`${durationText(over)} over your budget`:`${limit?'Remaining · ':'Completed · '}${durationText(t.goal)} ${limit?'budget':'goal'}`;}
   left=t.cadence==='daily'?'Resets at midnight':'Ongoing total';right=limit?(over?'Over budget':`${fmt(Math.max(0,(1-value/t.goal)*100))}% remaining`):value>=t.goal?'Goal reached':`${durationOrUnits(t,leftValue)} to go`;
   card.classList.toggle('over',limit&&over>0.5);
   if(t.kind==='timer'&&t.running_since!==null){left='Session in progress';card.querySelector('[data-meta-left]').classList.add('running-label');}
  }else{
   value=t.kind==='countdown'?Math.max(0,t.target_at-time):Math.max(0,time-t.start_at);
   ratio=t.kind==='countdown'?(time-t.start_at)/Math.max(1,t.target_at-t.start_at):value/t.goal;
   const parts=countdownParts(value);for(const [k,v]of Object.entries(parts))card.querySelector(`[data-part=${k}]`).textContent=k==='d'?fmt(v):pad(v);
   if(t.kind==='countdown'){sub=value>0?'Until '+new Date(t.target_at*1000).toLocaleString():'The wait is over. Your event has arrived.';left=value>0?'Time is moving forward':'Countdown complete';right=`${Math.round(Math.min(1,Math.max(0,ratio))*100)}% of the wait complete`;}
   else{sub='Since '+new Date(t.start_at*1000).toLocaleString();left=`${durationText(t.goal)} milestone`;right=value>=t.goal?'Milestone reached':durationText(t.goal-value)+' to go';}
  }
  const percent=Math.min(100,Math.max(0,ratio*100));card.querySelector('[data-sub]').textContent=sub;card.querySelector('[data-meta-left]').textContent=left;card.querySelector('[data-meta-right]').textContent=right;
  card.querySelector('.progress-line i').style.width=percent+'%';const progress=card.querySelector('[role=progressbar]');progress.setAttribute('aria-valuenow',Math.round(percent));progress.setAttribute('aria-valuetext',sub);
  const fill=card.querySelector('.ring .fill');if(fill){fill.style.strokeDashoffset=226.195*(1-percent/100);card.querySelector('[data-percent]').textContent=Math.round(percent)+'%';}
 });
}
function durationOrUnits(t,n){return t.kind==='timer'?durationText(n):`${fmt(n)} ${t.unit}`;}
function localInput(timestamp){const d=new Date(timestamp*1000);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}
function configureForm(){
 const kind=$('#f-kind').value,amount=['counter','timer'].includes(kind),timer=kind==='timer';
 $('#amount-fields').classList.toggle('hidden',!amount);$('#goal-fields').classList.toggle('hidden',kind==='countdown');$('#step-field').classList.toggle('hidden',!amount);$('#unit-field').classList.toggle('hidden',kind!=='counter');$('#countdown-fields').classList.toggle('hidden',kind!=='countdown');$('#start-field').classList.toggle('hidden',kind!=='streak');
 $('#goal-label').textContent=timer?'Target (minutes)':kind==='streak'?'Milestone (days)':'Target amount';$('#step-label').textContent=timer?'Default manual entry (minutes)':'Amount per click';
 for(const name of ['goal','step']){const input=$('#f-'+name);input.min=kind==='counter'?'1':'0.001';input.step=kind==='counter'?'1':'any';}
 const hints={counter:'Limits show units remaining and stop at zero. Goals count upward. Tally marks (çetele) show your logged units.',timer:'Start and pause sessions, or add minutes manually. Timers keep counting until paused, even if the app is closed.',countdown:'Watch days, hours, minutes, and seconds count down to your event.',streak:'Track time since a starting moment, with a milestone to work toward. Restart whenever you need a fresh beginning.'};
 $('#type-hint').textContent=hints[kind]+(editId?' Type and reset period are fixed; create a new tracker to change them.':'');
 $('#f-kind').disabled=!!editId;$('#f-cadence').disabled=!!editId||!amount;$('#f-start').disabled=!!editId||kind!=='streak';$('#f-goal').disabled=kind==='countdown';$('#f-step').disabled=!amount;$('#f-unit').disabled=kind!=='counter';$('#f-days').disabled=kind!=='countdown'||$('#f-event-mode').value!=='days';$('#f-target').disabled=kind!=='countdown'||$('#f-event-mode').value!=='date';
 $('#event-days-field').classList.toggle('hidden',$('#f-event-mode').value!=='days');$('#event-date-field').classList.toggle('hidden',$('#f-event-mode').value!=='date');
}
function drawAccents(){const colors={amber:'#d8ac63',mint:'#75baa1',blue:'#83aee3',rose:'#d68f9b',violet:'#b49bdc',cyan:'#75b8c8'};$('#accent-options').innerHTML=Object.entries(colors).map(([k,v])=>`<button type="button" class="accent-option ${k===selectedColor?'selected':''}" data-color-choice="${k}" style="--swatch:${v}" aria-label="${k}" aria-pressed="${k===selectedColor}"></button>`).join('');}
const presets={smoking:{title:'Daily cigarette limit',kind:'counter',direction:'limit',goal:10,step:1,unit:'cigarettes',color:'amber',note:'One intentional choice at a time.'},meditation:{title:'A moment of calm',kind:'timer',direction:'goal',goal:20,step:5,color:'mint',note:'A little space to breathe.'},screen:{title:'Screen time',kind:'timer',direction:'limit',goal:120,step:15,color:'blue',note:'Be here, a little more.'},event:{title:'Something to look forward to',kind:'countdown',goal:30,color:'violet'},free:{title:'Time smoke-free',kind:'streak',goal:30,color:'mint',note:'Every moment is progress.'}};
function openEditor(t=null,preset=null){
 editId=t?.id||null;const p=preset?presets[preset]:null;
 $('#editor-form').reset();$('#editor-error').textContent='';$('#editor-title').textContent=t?'Refine your tracker':'Make it your own';$('#save-tracker').textContent=t?'Save changes':'Create tracker';
 $('#f-title').value=t?.title||p?.title||'';$('#f-kind').value=t?.kind||p?.kind||'counter';$('#f-direction').value=t?.direction||p?.direction||'goal';$('#f-cadence').value=t?.cadence||'daily';
 const divisor=t?.kind==='timer'?60:t?.kind==='streak'?86400:1;
 $('#f-goal').value=t?t.goal/divisor:p?.goal||10;$('#f-step').value=t?t.step/(t.kind==='timer'?60:1):p?.step||1;$('#f-unit').value=t?.unit||p?.unit||'units';$('#f-note').value=t?.note||p?.note||'';
 $('#f-event-mode').value=t?.kind==='countdown'?'date':'days';$('#f-days').value=30;$('#f-target').value=localInput(t?.target_at||now()+30*86400);$('#f-start').value=localInput(t?.start_at||now());selectedColor=t?.color||p?.color||'amber';
 configureForm();drawAccents();$('#editor').showModal();
}
$('#f-kind').addEventListener('change',()=>{const kind=$('#f-kind').value;$('#f-goal').value=kind==='timer'?20:kind==='streak'?30:10;$('#f-step').value=kind==='timer'?5:1;configureForm();});
$('#f-event-mode').addEventListener('change',configureForm);
$('#editor-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('#save-tracker');button.disabled=true;$('#editor-error').textContent='';
 try{
  const kind=$('#f-kind').value,multiplier=kind==='timer'?60:kind==='streak'?86400:1;
  let target=null;
  if(kind==='countdown')target=$('#f-event-mode').value==='days'?now()+Number($('#f-days').value)*86400:new Date($('#f-target').value).getTime()/1000;
  const data={op:editId?'edit':'create',id:editId,title:$('#f-title').value,kind,direction:$('#f-direction').value,cadence:$('#f-cadence').value,unit:$('#f-unit').value||'units',goal:Number($('#f-goal').value)*multiplier,step:Number($('#f-step').value)*(kind==='timer'?60:1),note:$('#f-note').value,color:selectedColor};
  if(kind==='countdown'){if(!Number.isFinite(target)||target<=now())throw new Error('Choose a future event date.');data.target_at=editId&&Math.abs(target-byId(editId).target_at)<1?byId(editId).target_at:target;}
  if(kind==='streak'){data.start_at=editId?byId(editId).start_at:new Date($('#f-start').value).getTime()/1000;if(!Number.isFinite(data.start_at)||data.start_at>now())throw new Error('Choose a start time in the past or present.');}
  await mutate(data);$('#editor').close();toast(editId?'Tracker updated.':'Your new tracker is ready.');
 }catch(err){$('#editor-error').textContent=err.message;}finally{button.disabled=false;}
});
function openEntry(t){entryId=t.id;$('#entry-title').textContent=t.kind==='timer'?'Log some time':'Log an entry';$('#entry-subtitle').textContent=t.title;$('#entry-label').textContent=t.kind==='timer'?'Minutes':t.unit;$('#entry-amount').value=t.step/(t.kind==='timer'?60:1);$('#entry-amount').step=t.kind==='timer'?'any':'1';$('#entry-amount').min=t.kind==='timer'?'0.001':'1';$('#entry-error').textContent='';$('#entry-dialog').showModal();}
$('#entry-form').addEventListener('submit',async e=>{e.preventDefault();const t=byId(entryId),button=e.submitter;button.disabled=true;try{await mutate({op:'add',id:t.id,amount:Number($('#entry-amount').value)*(t.kind==='timer'?60:1)});$('#entry-dialog').close();toast('Entry saved.');}catch(err){$('#entry-error').textContent=err.message;}finally{button.disabled=false;}});
async function openHistory(t){
 historyId=t.id;$('#history-title').textContent=t.title;$('#history-subtitle').textContent=['counter','timer'].includes(t.kind)?'Your last 14 days · daily amounts':'Your journey and recent activity';$('#history-content').innerHTML='<p class="hint">Loading your progress…</p>';$('#history-undo').disabled=!t.can_undo||!!t.archived;if(!$('#history').open)$('#history').showModal();
 try{
  const data=await storage.history(profileId,t.id);if(historyId!==t.id)return;
  const max=Math.max(1,...data.days.map(d=>d.value));
  const chart=['counter','timer'].includes(t.kind)?`<div class="eyebrow">14-day activity</div><div class="history-chart" role="img" aria-label="${esc(data.days.map(d=>d.day+': '+durationOrUnits(t,d.value)).join('; '))}">${data.days.map(d=>`<div class="bar-column" title="${esc(d.day+' · '+durationOrUnits(t,d.value))}"><div class="bar" style="height:${Math.max(2,d.value/max*110)}px"></div><span>${d.day.slice(8)}</span></div>`).join('')}</div><div class="chart-caption"><span>${esc(data.days[0].day)}</span><span>Hover a bar for its amount</span><span>Today</span></div>`:'';
  const entries=data.entries.length?`<ul class="activity">${data.entries.map(e=>`<li class="${e.undone?'undone':''}"><div>${e.kind==='restart'?'Fresh start':e.kind==='session'?'Timed session':'Manual entry'}${e.undone?' · undone':''}<small>${esc(new Date(e.at*1000).toLocaleString())}</small></div><strong>${e.kind==='restart'?'Restarted':esc(durationOrUnits(t,e.amount))}</strong></li>`).join('')}</ul>`:'<p class="hint" style="margin-top:14px">No logged entries yet. Countdown progress and elapsed time are calculated live.</p>';
  $('#history-content').innerHTML=chart+'<div class="eyebrow">Recent activity · latest 80 entries</div>'+entries+`<div style="display:flex;gap:8px;margin-top:22px" data-id="${t.id}"><button class="button secondary" data-action="archive">${icon('archive')}${t.archived?'Restore tracker':'Archive tracker'}</button><button class="button danger" data-action="delete">${icon('trash')}Delete</button></div>`;
 }catch(err){$('#history-content').textContent=err.message;}
}
$('#history-undo').addEventListener('click',async()=>{const button=$('#history-undo');button.disabled=true;try{await mutate({op:'undo',id:historyId});await openHistory(byId(historyId));toast('Last entry undone.');}catch(err){toast(err.message);button.disabled=false;}});
function confirmAction(t,op){confirmJob={t,op};$('#confirm-title').textContent=op==='delete'?'Delete this tracker?':'Start a fresh chapter?';$('#confirm-message').textContent=op==='delete'?`This permanently deletes “${t.title}” and its entire history. Export a backup first if you want to keep it.`:`Restart the elapsed time for “${t.title}” from now? This restart will appear in History and can be undone.`;$('#confirm-field').classList.toggle('hidden',op!=='delete');$('#confirm-input').value='';$('#confirm-error').textContent='';$('#confirm-submit').textContent=op==='delete'?'Delete permanently':'Restart now';$('#confirm-dialog').showModal();}
$('#confirm-form').addEventListener('submit',async e=>{e.preventDefault();const {t,op}=confirmJob,button=e.submitter;button.disabled=true;try{await mutate({op,id:t.id,confirm:$('#confirm-input').value});$('#confirm-dialog').close();if($('#history').open)$('#history').close();toast(op==='delete'?'Tracker deleted.':'A fresh start, from this moment.');}catch(err){$('#confirm-error').textContent=err.message;}finally{button.disabled=false;}});
$('#theme-select').addEventListener('change',async e=>{const theme=e.target.value;applyTheme(theme);try{await mutate({op:'theme',theme});}catch(err){toast(err.message);}});
document.addEventListener('click',async e=>{
 const close=e.target.closest('[data-close]');if(close){close.closest('dialog').close();return;}
 const color=e.target.closest('[data-color-choice]');if(color){selectedColor=color.dataset.colorChoice;drawAccents();return;}
 const nav=e.target.closest('[data-filter]');if(nav){filter=nav.dataset.filter;signature='';render();return;}
 const preset=e.target.closest('[data-preset]');if(preset){openEditor(null,preset.dataset.preset);return;}
 const button=e.target.closest('[data-action]');if(!button||button.disabled)return;
 const action=button.dataset.action,id=button.closest('[data-id]')?.dataset.id,t=byId(id);
 if(action==='new'){openEditor();return;}if(action==='settings'){$('#settings').showModal();void showStorageStatus();return;}if(action==='edit'&&t){openEditor(t);return;}if(action==='entry'&&t){openEntry(t);return;}if(action==='history'&&t){await openHistory(t);return;}if(['reset','delete'].includes(action)&&t){confirmAction(t,action);return;}
 button.disabled=true;
 try{
  if(action==='refresh'){await refresh();return;}
  if(action==='mode'){const theme=pairs[document.documentElement.dataset.theme];applyTheme(theme);await mutate({op:'theme',theme});return;}
  if(!t)return;
  const op=action==='quick'?'add':action,data={op,id:t.id};if(action==='quick')data.amount=t.direction==='limit'?Math.min(t.step,Math.max(0,t.goal-t.value)):t.step;
  await mutate(data);
  if(action==='archive'&&$('#history').open)$('#history').close();
  if(['undo','archive'].includes(action))toast(action==='undo'?'Last entry undone.':t.archived?'Tracker restored.':'Tracker archived.');
 }catch(err){toast(err.message);}finally{button.disabled=false;tick();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
window.addEventListener('focus',()=>void refresh());
setInterval(tick,250);setInterval(()=>{if(!document.hidden)void refresh();},8000);storage.onchange=()=>{if(!document.hidden)void refresh();};void refresh();

function download(name,content,type){
 const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function filename(name){return name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'profile';}
async function showStorageStatus(){
 try{const kept=await navigator.storage?.persisted?.();$('#persistence-status').textContent=kept?'Persistent storage is enabled. Keep external backups too.':'Storage follows your browser’s retention policy.';}catch{}
}
$('#profile-select').addEventListener('change',e=>void switchProfile(e.target.value));
function openProfileDialog(rename){renameProfile=rename;$('#profile-title').textContent=rename?'Rename your profile':'Create a local profile';$('#profile-name').value=rename?state.profile.name:'';$('#profile-error').textContent='';$('#profile-dialog').showModal();}
$('#profile-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;
 try{if(renameProfile)await mutate({op:'rename-profile',name:$('#profile-name').value});else{const id=await storage.create($('#profile-name').value);await switchProfile(id);}$('#profile-dialog').close();toast(renameProfile?'Profile renamed.':'Your new space is ready.');}
 catch(err){$('#profile-error').textContent=err.message;}finally{button.disabled=false;}
});
function openImport(){
 importCandidate=null;importRevision=state?.profile.revision;$('#import-form').reset();$('#import-confirm').required=false;$('#import-submit').disabled=true;$('#import-preview').textContent='Choose a backup to preview its contents before importing.';$('#import-error').textContent='';$('#import-confirm-field').classList.add('hidden');$('#import-dialog').showModal();
}
$('#import-file').addEventListener('change',async e=>{
 importCandidate=null;$('#import-submit').disabled=true;$('#import-error').textContent='';const file=e.target.files[0];if(!file)return;
 try{if(file.size>20*1024*1024)throw new Error('Choose a backup smaller than 20 MB.');
  const candidate=JSON.parse(await file.text());if(e.target.files[0]!==file)return;const p=importProfile(candidate);
  importCandidate=candidate;importRevision=state.profile.revision;$('#import-preview').textContent=`${p.name} · ${p.trackers.length} trackers · ${p.events.length} entries. Imported timers will be paused.`;$('#import-submit').disabled=false;
 }catch(err){$('#import-error').textContent=err instanceof SyntaxError?'The selected file is not valid JSON.':err.message;}
});
$('#import-mode').addEventListener('change',e=>{const replace=e.target.value==='replace';$('#import-confirm-field').classList.toggle('hidden',!replace);$('#import-confirm').required=replace;$('#import-confirm-label').textContent=`Type “${state.profile.name}” to replace this profile`;});
$('#import-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!importCandidate)return;const button=e.submitter;button.disabled=true;
 try{await actionQueue;const options=$('#import-mode').value==='replace'?{replaceId:profileId,confirm:$('#import-confirm').value,expectedRevision:importRevision}:{};
  const id=await storage.import(importCandidate,options);await switchProfile(id);$('#import-dialog').close();toast('Profile imported. Your progress is here.');
 }catch(err){$('#import-error').textContent=err.message;}finally{button.disabled=false;}
});
document.addEventListener('click',async e=>{
 const wallet=e.target.closest('[data-copy-wallet]');
 if(wallet){const address=$('#wallet-'+wallet.dataset.copyWallet).textContent.trim();try{await navigator.clipboard.writeText(address);toast('Donation address copied.');}catch{const selection=getSelection(),range=document.createRange();range.selectNodeContents($('#wallet-'+wallet.dataset.copyWallet));selection.removeAllRanges();selection.addRange(range);toast('Address selected. Copy it using your browser.');}return;}
 const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 try{
  if(action==='new-profile'){openProfileDialog(false);return;}
  if(action==='rename-profile'){openProfileDialog(true);return;}
  if(action==='import-profile'){openImport();return;}
  if(action==='export-profile'){await actionQueue;const data=await storage.export(profileId);download(`tempo-${filename(data.profile.name)}-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2),'application/json');toast('Profile backup downloaded.');return;}
  if(action==='export-csv'){await actionQueue;download(`tempo-${filename(state.profile.name)}-history.csv`,await storage.csv(profileId),'text/csv;charset=utf-8');return;}
  if(action==='persist'){const allowed=await navigator.storage?.persist?.();$('#persistence-status').textContent=allowed?'Persistent storage enabled. Keep external backups too.':'Your browser did not grant persistence. JSON backups remain available.';return;}
 }catch(err){toast(err.message);}
});
if('serviceWorker' in navigator){
 navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready)
 .then(()=>{$('#offline-status').textContent='Offline files are ready on this browser.';})
 .catch(()=>{$('#offline-status').textContent='Offline caching is unavailable. Tracking still works while the page is open.';});
}
