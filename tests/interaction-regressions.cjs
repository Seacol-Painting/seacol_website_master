const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8');
function fixture({solid=false,menu=true}={}){
  let document;
  function element(classes=[]){
    const values=new Set(classes),events={};
    return {inert:false,events,attrs:{},style:{setProperty(k,v){this[k]=v}},dataset:{},
      classList:{contains:k=>values.has(k),toggle(k,v){if(v===undefined)v=!values.has(k);v?values.add(k):values.delete(k);return v}},
      addEventListener(k,f){(events[k]??=[]).push(f)},setAttribute(k,v){this.attrs[k]=v},focus(){document.activeElement=this}};
  }
  const header=element(solid?['scrolled']:[]),button=element(),nav=element(),links=[element(),element()],main=element(),footer=element();
  footer.inert=true;nav.querySelector=()=>links[0];nav.querySelectorAll=()=>links;
  const range=element();range.value='50';const layer=element(),base={complete:true,naturalWidth:2048,naturalHeight:970};
  const box=element();box.querySelector=s=>s==='input'?range:s==='.comparison-after'?layer:base;
  document=element();document.body=element();document.documentElement={};document.head={appendChild(){}};document.createElement=()=>element();
  document.querySelector=s=>({'.site-header':header,'.menu-button':menu?button:null,'#site-nav':menu?nav:null}[s]??null);
  document.querySelectorAll=s=>s==='main,footer'?[main,footer]:s==='[data-comparison]'?[box]:[];
  const window=element();window.innerWidth=390;window.scrollY=0;
  const ctx=vm.createContext({document,window,console});vm.runInContext(source,ctx);
  const run=s=>vm.runInContext(s,ctx);return {run,document,window,header,button,nav,links,main,footer,range,layer};
}
let f=fixture({solid:true});
f.window.scrollY=200;f.run('updateHeader()');f.window.scrollY=0;f.run('updateHeader()');assert(f.header.classList.contains('scrolled'),'Gallery header stays solid at top');
f=fixture();assert(!f.header.classList.contains('scrolled'));f.window.scrollY=100;f.run('updateHeader()');assert(f.header.classList.contains('scrolled'));
f.run('setMenu(true)');assert.equal(f.button.attrs['aria-expanded'],'true');assert(f.main.inert);assert.equal(f.document.activeElement,f.links[0]);
f.links[1].focus();let prevented=false;for(const h of f.document.events.keydown)h({key:'Tab',preventDefault(){prevented=true}});assert(prevented);assert.equal(f.document.activeElement,f.button);
for(const h of f.document.events.keydown)h({key:'Escape'});assert(!f.main.inert);assert(f.footer.inert,'Preserve existing inert state');assert.equal(f.document.activeElement,f.button);
f.run('setMenu(true)');f.window.innerWidth=1200;for(const h of f.window.events.resize)h();assert(!f.nav.classList.contains('open'));assert(!f.main.inert);
for(const v of ['0','50','100']){f.range.value=v;for(const h of f.range.events.input)h();assert.equal(f.layer.style.clipPath,`inset(0 ${100-v}% 0 0)`)}
const data=new Map([['name','QA'],['email','qa@example.com'],['city','Seattle'],['project','Interior'],['property','Residential'],['details','café & trim + doors']]);
if(f.run('typeof prepareEstimateRequest')==='function'){
  const request=f.run('prepareEstimateRequest')(data);assert.equal(new URL(request.email).searchParams.get('body'),request.body);assert(request.body.includes('café & trim + doors'));
}
fixture({menu:false});console.log('PASS: solid gallery header, home scroll header, menu focus/escape/resize, restored background state, slider endpoints, legacy estimate fallback when present, and pages without navigation.');
