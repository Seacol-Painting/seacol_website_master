const menuExperience=document.createElement('link');
menuExperience.rel='stylesheet';
menuExperience.href='menu-experience.css';
document.head.appendChild(menuExperience);

const header=document.querySelector('.site-header');
const menuButton=document.querySelector('.menu-button');
const nav=document.querySelector('#site-nav');

window.addEventListener('scroll',()=>header.classList.toggle('scrolled',window.scrollY>35));

function setMenu(open){
  nav.classList.toggle('open',open);
  header.classList.toggle('menu-active',open);
  document.body.classList.toggle('menu-open',open);
  menuButton.setAttribute('aria-expanded',String(open));
  menuButton.setAttribute('aria-label',open?'Close menu':'Open menu');
}

menuButton.addEventListener('click',()=>setMenu(!nav.classList.contains('open')));
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>setMenu(false)));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){setMenu(false);menuButton.focus();}});
window.addEventListener('resize',()=>{if(window.innerWidth>850&&nav.classList.contains('open'))setMenu(false)});

let touchStartX=0;
nav.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX},{passive:true});
nav.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(dx>85&&nav.classList.contains('open'))setMenu(false)},{passive:true});

document.querySelectorAll('[data-comparison]').forEach(box=>{
  const range=box.querySelector('input');
  const after=box.querySelector('.comparison-after');
  const update=()=>{
    after.style.clipPath=`inset(0 ${100-range.value}% 0 0)`;
    box.style.setProperty('--comparison',range.value+'%');
  };
  range.addEventListener('input',update);
  update();
});

let lang='en';
const toggle=document.querySelector('#lang-toggle');
function applyLanguage(next){
  lang=next;
  document.documentElement.lang=lang;
  document.querySelectorAll('[data-en][data-es]').forEach(el=>{
    const value=el.dataset[lang];
    if(el.tagName==='OPTION')el.textContent=value;
    else el.innerHTML=value;
  });
  toggle.textContent=lang==='en'?'ES':'EN';
  localStorage.setItem('seacol-lang',lang);
}
toggle.addEventListener('click',()=>applyLanguage(lang==='en'?'es':'en'));
applyLanguage(localStorage.getItem('seacol-lang')||'en');

document.querySelector('#year').textContent=new Date().getFullYear();
document.querySelector('#estimate-form').addEventListener('submit',e=>{
  e.preventDefault();
  const d=new FormData(e.currentTarget);
  const lines=lang==='es'?
    [`Hola SEACOL, quisiera solicitar un estimado gratis.`,`Nombre: ${d.get('name')}`,`Ciudad: ${d.get('city')}`,`Proyecto: ${d.get('project')}`,`Propiedad: ${d.get('property')}`,`Detalles: ${d.get('details')}`]:
    [`Hello SEACOL, I would like to request a free estimate.`,`Name: ${d.get('name')}`,`City: ${d.get('city')}`,`Project: ${d.get('project')}`,`Property: ${d.get('property')}`,`Details: ${d.get('details')}`];
  window.location.href=`sms:+12065732474?&body=${encodeURIComponent(lines.join('\n'))}`;
});
