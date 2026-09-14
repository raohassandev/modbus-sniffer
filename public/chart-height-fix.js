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

  const forceStyle=(name,value)=>{
    if(canvas.style.getPropertyValue(name)!==value||canvas.style.getPropertyPriority(name)!=='important'){
      canvas.style.setProperty(name,value,'important');
    }
  };
  const forceLayout=()=>{
    forceStyle('width','100%');
    forceStyle('height','100%');
    forceStyle('min-height','0');
    forceStyle('max-height','none');
  };

  // The frame owns layout. Canvas width/height are backing-store pixels only.
  canvas.removeAttribute('height');
  forceLayout();

  let raf=0,lastW=0,lastH=0,lastDpr=0;
  const enforce=()=>{
    raf=0;
    forceLayout();
    const rect=frame.getBoundingClientRect();
    const cssW=Math.max(1,Math.round(rect.width));
    const cssH=Math.max(1,Math.round(rect.height));
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const pixelW=Math.max(1,Math.round(cssW*dpr));
    const pixelH=Math.max(1,Math.round(cssH*dpr));

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
  // Re-applying identical !important values is avoided so this observer cannot self-loop.
  new MutationObserver(schedule).observe(canvas,{attributes:true,attributeFilter:['style','width','height']});

  schedule();
})();
