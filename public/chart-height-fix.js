'use strict';

(()=>{
  const canvas=document.getElementById('trafficChart');
  if(!canvas)return;

  let frame=canvas.closest('.traffic-chart-frame');
  if(!frame){
    frame=document.createElement('div');
    frame.className='traffic-chart-frame';
    canvas.parentNode.insertBefore(frame,canvas);
    frame.appendChild(canvas);
  }

  // The frame owns layout. Canvas width/height are backing-store pixels only.
  canvas.removeAttribute('height');
  canvas.style.setProperty('width','100%','important');
  canvas.style.setProperty('height','100%','important');
  canvas.style.setProperty('min-height','0','important');
  canvas.style.setProperty('max-height','none','important');

  let raf=0,lastW=0,lastH=0,lastDpr=0;
  const enforce=()=>{
    raf=0;
    const rect=frame.getBoundingClientRect();
    const cssW=Math.max(1,Math.round(rect.width));
    const cssH=Math.max(1,Math.round(rect.height));
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const pixelW=Math.max(1,Math.round(cssW*dpr));
    const pixelH=Math.max(1,Math.round(cssH*dpr));

    // Inline styles from older renderers must never be allowed to drive layout.
    canvas.style.setProperty('width','100%','important');
    canvas.style.setProperty('height','100%','important');

    // Only touch the backing bitmap when the actual frame size/DPI changed.
    if(cssW!==lastW||cssH!==lastH||dpr!==lastDpr){
      if(canvas.width!==pixelW)canvas.width=pixelW;
      if(canvas.height!==pixelH)canvas.height=pixelH;
      lastW=cssW;lastH=cssH;lastDpr=dpr;
      try{renderStatus();}catch{}
    }
  };
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(enforce);};

  new ResizeObserver(schedule).observe(frame);
  window.addEventListener('resize',schedule,{passive:true});

  // Guard against legacy renderers writing canvas.style.height on each live refresh.
  const styleObserver=new MutationObserver(schedule);
  styleObserver.observe(canvas,{attributes:true,attributeFilter:['style','width','height']});

  schedule();
})();
