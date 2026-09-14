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
    forceStyle('padding','0');
  };

  // The wrapper is the single source of truth for layout height.
  // Do not let the legacy renderer reintroduce an intrinsic 220px height.
  canvas.removeAttribute('height');
  forceLayout();

  // Override the legacy helper used by drawLine(). The old implementation used the
  // HTML height attribute (220px) and rewrote canvas.style.height on every refresh,
  // while the v6.2 wrapper is 260px. That caused the backing bitmap to oscillate
  // between two heights once per live update and could leave Chromium showing a
  // blank/white canvas. Use the actual rendered wrapper size instead.
  window.setupCanvas=function setupCanvasV62(target){
    if(!target)return null;
    const rect=target.getBoundingClientRect();
    const w=Math.max(1,Math.round(rect.width));
    const h=Math.max(1,Math.round(rect.height));
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const pixelW=Math.max(1,Math.round(w*ratio));
    const pixelH=Math.max(1,Math.round(h*ratio));

    if(target.width!==pixelW)target.width=pixelW;
    if(target.height!==pixelH)target.height=pixelH;

    const ctx=target.getContext('2d');
    if(!ctx)return null;
    // Reset the transform every draw so resize operations cannot accumulate scale.
    ctx.setTransform(ratio,0,0,ratio,0,0);
    return{ctx,w,h};
  };

  let raf=0,lastW=0,lastH=0;
  const redraw=()=>{
    raf=0;
    forceLayout();
    const rect=frame.getBoundingClientRect();
    const w=Math.round(rect.width),h=Math.round(rect.height);
    if(w===lastW&&h===lastH)return;
    lastW=w;lastH=h;
    try{renderStatus();}catch{}
  };
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(redraw);};

  new ResizeObserver(schedule).observe(frame);
  window.addEventListener('resize',schedule,{passive:true});

  // Initial render after the wrapper is established.
  requestAnimationFrame(()=>{try{renderStatus();}catch{}});
})();
