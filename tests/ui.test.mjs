/** Offline DOM stubs exercise view logic; these do not replace visual browser QA. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {newProfile, snapshot, importProfile, applyAction, uid} from '../site/engine.mjs';

async function harness() {
  const elements = new Map(), listeners = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {value: '', textContent: '', innerHTML: '', dataset: {}, style: {}, callbacks: {},
        disabled: false, hidden: false, open: false, required: false, files: [],
        classList: {toggle(c, on) {on ? classes.add(c) : classes.delete(c);}, add(c) {classes.add(c);}, contains(c) {return classes.has(c);}},
        addEventListener(type, fn) {this.callbacks[type] = fn;},
        setAttribute(k, v) {this[k] = v;}, reset() {}, showModal() {this.open = true;}, close() {this.open = false;},
        querySelector(sel) {return element(selector + ' ' + sel);},
      });
    }
    return elements.get(selector);
  }
  const document = {documentElement: {dataset: {}}, querySelector: element, querySelectorAll: () => [],
    addEventListener(type, fn) {const list = listeners.get(type) || [];list.push(fn);listeners.set(type,list);}, hidden: false};
  class MemoryStorage {
    constructor() {this.name='test';this.profiles=[newProfile('My space')];}
    async open() {}
    async list() {return this.profiles.map(p=>({id:p.id,name:p.name,revision:p.revision}));}
    async state(id) {return snapshot(this.profiles.find(p=>p.id===id));}
    async mutate(id,data,key) {return applyAction(this.profiles.find(p=>p.id===id),data,key);}
  }
  const context = vm.createContext({document, window:{addEventListener() {}}, console, performance:{now:()=>0},
    Date, Intl, setTimeout:()=>0, clearTimeout() {}, setInterval() {}, crypto, structuredClone,
    navigator:{}, sessionStorage:{getItem:()=>null,setItem(){}}, TempoStorage:MemoryStorage, importProfile});
  let source=await readFile(new URL('../site/app.mjs',import.meta.url),'utf8');
  source=source.replace(/^import .+ from .+;$/gm,'');
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  await run('refresh()');
  return {run,element,document,listeners};
}

test('dashboard initializes from local storage with no network client', async()=>{
  const {run,element}=await harness();
  assert.equal(run('online'),true);assert.match(element('#profile-select').innerHTML,/My space/);
  assert.match(element('#tracker-grid').innerHTML,/Your next small win/);
});
test('live duration formatting and countdown parts are exact', async()=>{
  const {run}=await harness();
  assert.equal(run('secondsText(3661.9)'),'01:01:01');assert.equal(run('secondsText(-2)'),'00:00:00');
  assert.equal(run('JSON.stringify(countdownParts(90061))'),'{"d":1,"h":1,"m":1,"s":1}');
});
test('card rendering escapes imported tracker text', async()=>{
  const {run}=await harness();
  const html=run(`cardMarkup({id:'${uid()}',title:'<img onerror="bad()">',note:'<script>bad()</script>',kind:'counter',direction:'limit',cadence:'daily',color:'amber',value:0,step:1,unit:'units'})`);
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>bad/);
});
test('tally groups and daily active time use correct amounts', async()=>{
  const {run}=await harness();
  assert.equal((run('tallyMarkup(5)').match(/<path/g)||[]).length,5);
  assert.match(run('tallyMarkup(37)'),/\+7 more/);
  run('state.day_start=1000');
  assert.equal(run('elapsedValue({cadence:"daily",running_since:900,value:10},1050)'),60);
});
test('six themes toggle as three light/dark pairs', async()=>{
  const {run,document}=await harness();
  for(const theme of ['midnight','paper','forest','sage','violet','rose']){
    run(`applyTheme('${theme}')`);assert.equal(document.documentElement.dataset.theme,theme);
    assert.equal(run(`pairs[pairs['${theme}']]`),theme);
  }
});
test('presets disable hidden form constraints correctly', async()=>{
  const {run,element}=await harness();
  run("openEditor(null,'event')");assert.equal(element('#f-goal').disabled,true);
  assert.equal(element('#f-days').disabled,false);assert.equal(element('#f-target').disabled,true);
  run("openEditor(null,'free')");assert.equal(element('#f-step').disabled,true);assert.equal(element('#f-start').disabled,false);
});
test('live remaining counter reaches zero and disables its button', async()=>{
  const {run,element,document}=await harness(),card=element('test-card');card.dataset.id='a';
  document.querySelectorAll=sel=>sel==='.card[data-id]'?[card]:[];
  run('state.trackers=[{id:"a",kind:"counter",direction:"limit",cadence:"daily",goal:10,step:1,value:3,unit:"cigarettes",running_since:null}];tick()');
  assert.match(element('test-card [data-metric]').innerHTML,/7<small>left/);
  run('state.trackers[0].value=10;tick()');assert.equal(element('test-card [data-action=quick]').disabled,true);
});
test('reopening import clears a hidden replacement-name constraint', async()=>{
  const {run,element}=await harness();
  element('#import-confirm').required=true;run('openImport()');
  assert.equal(element('#import-confirm').required,false);assert.equal(element('#import-submit').disabled,true);
});
test('profile switching does not discard an already queued mutation', async()=>{
  const {run}=await harness();
  run("storage.profiles.push({...structuredClone(storage.profiles[0]),id:'b'.repeat(32),name:'Second',trackers:[],events:[],requests:[]}); const createJob=mutate({op:'create',title:'Queued',kind:'counter',goal:10}); const changeJob=switchProfile('b'.repeat(32));");
  await run('Promise.all([createJob,changeJob])');
  assert.equal(run('storage.profiles[0].trackers.length'),1);
  assert.equal(run('storage.profiles[1].trackers.length'),0);
  assert.equal(run('state.profile.name'),'Second');
});
