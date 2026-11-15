const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function fixture(mediaDevices){
 const nodes=new Map(),downloads=[],blobs=[];
 const context={drawImage(){},putImageData(){},getImageData(x,y,width,height){return {width,height,data:new Uint8ClampedArray(width*height*4)}}};
 function el(){return {hidden:false,value:'',textContent:'',dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},appendChild(x){this.children.push(x)},addEventListener(type,fn){this["on"+type]=fn},play:async()=>{},getContext(){return context},setAttribute(){},remove(){},click(){downloads.push({name:this.download,url:this.href})},toBlob(cb){cb(new Blob(['png'],{type:'image/png'}))}};}
 const brands=['sherwin','benjamin','ppg'].map(c=>Object.assign(el(),{dataset:{catalog:c}}));
 const document={querySelector(s){if(!nodes.has(s))nodes.set(s,el());return nodes.get(s)},querySelectorAll(){return brands},createElement:el,body:el()};
 const sandbox={navigator:{mediaDevices},document,window:{addEventListener(){}},console,Blob,URL:{createObjectURL(b){blobs.push(b);return 'blob:test'},revokeObjectURL(){}},setTimeout(){},localStorage:{setItem(){throw Error('blocked')}},ImageData:class{constructor(d,w,h){this.data=d;this.width=w;this.height=h}}};
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

test('camera opens, flips, returns, and captures portrait and landscape frames',async()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    let stopped=0;
    const facing=[];
    const f=fixture({async getUserMedia({video}){
      facing.push(video.facingMode.ideal);
      return {getTracks:()=>[{stop(){stopped++}}]};
    }});
    const button=id=>f.nodes.get('#'+id).onclick();
    await button('open-camera');
    assert.equal(f.nodes.get('#camera-shell').hidden,false);
    await button('flip-camera');
    button('close-camera');
    assert.equal(f.nodes.get('#capture-card').hidden,false);
    await button('open-camera');
    Object.assign(f.nodes.get('#camera'),{videoWidth:width,videoHeight:height});
    button('capture-view');
    assert.equal(f.nodes.get('#workspace').hidden,false);
    assert.deepEqual([f.qa.state.original.width,f.qa.state.original.height],[width,height]);
    assert.equal(stopped,3);
    assert.deepEqual(facing,['environment','user','user']);
  }
});
test('estimate link includes only painted surfaces and clears previous colors',()=>{
  const f=fixture(), link=f.nodes.get('#estimate-link');
  f.qa.state.surfaces=[{name:'Wall 1',color:'#EDEAE0',brand:'Sherwin-Williams',colorName:'Alabaster',colorCode:'SW7008'}];
  link.onclick({currentTarget:link});
  assert.equal(new URL(link.href,'https://example.com').searchParams.get('colors'),'Wall 1: Sherwin-Williams | Alabaster | SW7008 | #EDEAE0');
  f.qa.state.surfaces=[];
  link.onclick({currentTarget:link});
  assert.equal(link.href,'/#estimate');
});
