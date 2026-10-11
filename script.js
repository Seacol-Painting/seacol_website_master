const menuExperience=document.createElement('link');
menuExperience.rel='stylesheet';
menuExperience.href='menu-experience.css?v=menu-fixes-1';
document.head.appendChild(menuExperience);


const header=document.querySelector('.site-header');
const menuButton=document.querySelector('.menu-button');
const nav=document.querySelector('#site-nav');

const keepHeaderSolid=header?.classList.contains('scrolled');
const updateHeader=()=>header?.classList.toggle('scrolled',keepHeaderSolid||window.scrollY>35);
window.addEventListener('scroll',updateHeader,{passive:true});
updateHeader();

const backgroundRegions=[...document.querySelectorAll('main,footer')];
let previousInert=[];

function setMenu(open){
  if(!nav||!menuButton||!header) return;
  open=Boolean(open&&window.innerWidth<=850);
  const wasOpen=nav.classList.contains('open');
  nav.classList.toggle('open',open);
  header.classList.toggle('menu-active',open);
  document.body.classList.toggle('menu-open',open);
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.setAttribute('aria-label',open?'Close menu':'Open menu');
  if(open&&!wasOpen){
    previousInert=backgroundRegions.map(region=>region.inert);
    backgroundRegions.forEach(region=>{region.inert=true});
    nav.querySelector('a')?.focus();
  }else if(!open&&wasOpen){
    backgroundRegions.forEach((region,index)=>{region.inert=previousInert[index]});
  }
}

if(menuButton&&nav){
menuButton.setAttribute('aria-label','Open menu');
menuButton.addEventListener('click',()=>setMenu(!nav.classList.contains('open')));
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){setMenu(false);menuButton.focus();}});
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab'||!nav.classList.contains('open')) return;
  const controls=[menuButton,...nav.querySelectorAll('a[href]')];
  const first=controls[0],last=controls[controls.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  else if(!controls.includes(document.activeElement)){e.preventDefault();first.focus()}
});
window.addEventListener('resize',()=>{if(window.innerWidth>850&&nav.classList.contains('open'))setMenu(false)});

let touchStartX=0;
nav.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX},{passive:true});
nav.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(dx>85&&nav.classList.contains('open'))setMenu(false)},{passive:true});
}

document.querySelectorAll('[data-comparison]').forEach(box=>{
  const range=box.querySelector('input');
  const after=box.querySelector('.comparison-after');
  const base=box.querySelector(':scope > img');
  if(!range||!after) return;
  const fitRatio=()=>{
    if(base?.naturalWidth&&base?.naturalHeight){
      const ratio=base.naturalWidth/base.naturalHeight;
      const safe=Math.min(2.2,Math.max(.72,ratio));
      box.style.setProperty('--photo-ratio',String(safe));
      box.dataset.ratioReady='true';
    }
  };
  const update=()=>{
    after.style.clipPath=`inset(0 ${100-range.value}% 0 0)`;
    box.style.setProperty('--comparison',range.value+'%');
  };
  if(base){
    if(base.complete) fitRatio();
    else base.addEventListener('load',fitRatio,{once:true});
  }
  range.addEventListener('input',update);
  update();
});

document.documentElement.lang='en';
const year=document.querySelector('#year');
if(year) year.textContent=new Date().getFullYear();

function prepareEstimateRequest(data){
  const lines=[
    'Hello SEACOL PAINTING LLC, I would like to request a free estimate.',
    `Name: ${data.get('name')}`,
    `Email: ${data.get('email')}`,
    `Phone: ${data.get('phone') || 'Not provided'}`,
    `City: ${data.get('city')}`,
    `Project: ${data.get('project')}`,
    `Property: ${data.get('property')}`,
    `Details: ${data.get('details')}`
  ];
  const body=lines.join('\n');
  return {
    body,
    email:`mailto:info@seacolpaintingllc.com?subject=${encodeURIComponent('Estimate request - '+data.get('project'))}&body=${encodeURIComponent(body)}`,
    sms:`sms:+12065732474?body=${encodeURIComponent(body)}`
  };
}
const estimateForm=document.querySelector('#estimate-form');
if(estimateForm){
  const options=document.querySelector('#request-options');
  const status=document.querySelector('#copy-status');
  estimateForm.addEventListener('submit',e=>{
    e.preventDefault();
    const request=prepareEstimateRequest(new FormData(estimateForm));
    document.querySelector('#send-email').href=request.email;
    document.querySelector('#send-text').href=request.sms;
    document.querySelector('#request-preview').value=request.body;
    status.textContent='';
    options.hidden=false;
    document.querySelector('#request-options-title').focus();
  });
  estimateForm.addEventListener('input',e=>{
    if(e.target.closest('#request-options')) return;
    options.hidden=true;
    status.textContent='';
  });
  document.querySelector('#copy-request').addEventListener('click',async()=>{
    const preview=document.querySelector('#request-preview');
    try{
      await navigator.clipboard.writeText(preview.value);
      status.textContent='Request copied. Paste it into your email or messaging app.';
    }catch{
      preview.focus();preview.select();
      status.textContent='Select and copy the request above, then paste it into your email or messaging app.';
    }
  });
}
