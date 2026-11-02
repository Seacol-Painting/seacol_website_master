const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const nodes=new Map(),downloads=[],blobs=[];
 const context={drawImage(){},putImageData(){}};
 function el(){return {hidden:false,value:'',textContent:'',dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},appendChild(x){this.children.push(x)},addEventListener(){},getContext(){return context},setAttribute(){},remove(){},click(){downloads.push({name:this.download,url:this.href})},toBlob(cb){cb(new Blob(['png'],{type:'image/png'}))}};}
 const brands=['sherwin','benjamin','ppg'].map(c=>Object.assign(el(),{dataset:{catalog:c}}));
 const document={querySelector(s){if(!nodes.has(s))nodes.set(s,el());return nodes.get(s)},querySelectorAll(){return brands},createElement:el,body:el()};
 const sandbox={document,window:{addEventListener(){}},console,Blob,URL:{createObjectURL(b){blobs.push(b);return 'blob:test'},revokeObjectURL(){}},setTimeout(){},localStorage:{setItem(){throw Error('blocked')}},ImageData:class{constructor(d,w,h){this.data=d;this.width=w;this.height=h}}};
 const source=fs.readFileSync('color-chart.js','utf8').replace('renderColors();\n})();','globalThis.qa={state,applyColor,downloadPreview,downloadNotes,saveProject};renderColors();\n})();');
 vm.runInNewContext(source,sandbox);
 return {nodes,brands,downloads,blobs,qa:sandbox.qa};
}
test('script initializes all brand buttons and paints each catalog',()=>{
 const f=fixture();for(const b of f.brands){assert.equal(typeof b.onclick,'function');b.onclick();assert.equal(f.qa.state.catalog,b.dataset.catalog);assert(f.nodes.get('#color-grid').children.length>0);}
});
test('exports recolored preview and readable branded color notes; blocked storage is recoverable',async()=>{
 const f=fixture();f.qa.state.original={width:1,height:1,data:new Uint8ClampedArray([100,100,100,255])};
 f.qa.state.surfaces=[{id:'wall-1',name:'Wall 1',mask:new Uint8Array([255]),mw:1,mh:1}];f.qa.state.activeSurface='wall-1';
 f.qa.applyColor('#CDD2CA','Sea Salt','SW6204','Sherwin-Williams');
 f.qa.downloadNotes();assert.match(await f.blobs[0].text(),/Wall 1: Sherwin-Williams \| Sea Salt \| SW6204/);
 f.qa.state.originalHeld=true;f.qa.downloadPreview();assert.equal(f.qa.state.originalHeld,true);
 assert.deepEqual(f.downloads.map(d=>d.name),['SEACOL-color-notes.txt','SEACOL-room-preview.png']);
 f.qa.saveProject();assert.match(f.nodes.get('#save-status').textContent,/storage is unavailable/);
});
