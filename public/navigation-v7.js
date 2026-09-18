'use strict';
(()=>{
  const nav=document.querySelector('.nav');if(!nav||nav.dataset.grouped==='1')return;
  nav.dataset.grouped='1';
  const buttons=[...nav.querySelectorAll('.nav-item[data-page]')];
  const byPage=new Map(buttons.map(b=>[b.dataset.page,b]));
  const groups=[
    ['CORE',['dashboard','master','slave','devices']],
    ['ANALYZE',['traffic','analysis','registers','decoder','discovery']],
    ['LAB',['transportLab','rawLab','testSequences','deviceClone']],
    ['EVIDENCE',['loggerTrend','compare','sessions']],
    ['SYSTEM',['settings']]
  ];
  const used=new Set();
  for(const [label,pages] of groups){
    const existing=pages.map(p=>byPage.get(p)).filter(Boolean);if(!existing.length)continue;
    const heading=document.createElement('div');heading.className='nav-section-heading';heading.textContent=label;nav.appendChild(heading);
    for(const button of existing){nav.appendChild(button);used.add(button);}
  }
  const leftovers=buttons.filter(b=>!used.has(b));
  if(leftovers.length){
    const heading=document.createElement('div');heading.className='nav-section-heading';heading.textContent='MORE';nav.appendChild(heading);
    leftovers.forEach(b=>nav.appendChild(b));
  }
})();