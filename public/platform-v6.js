'use strict';

window.addEventListener('DOMContentLoaded',()=>{
  // Load the v6.2 visual foundation immediately instead of waiting for nested scripts.
  // This also makes the fixed chart layout and theme available before the first live redraw.
  for(const href of ['/platform-v62.css?v=20260914-2','/chart-height-fix.css?v=20260914-1','/device-inventory-v62.css?v=20260914-1']){
    if(document.querySelector(`link[href="${href}"]`))continue;
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);
  }

  const badge=document.querySelector('.version-badge');if(badge)badge.textContent='UI v6.2';

  const main=document.createElement('script');
  main.src='/platform-v62-main.js?v=20260914-2';
  main.onload=()=>{
    const exportsScript=document.createElement('script');
    exportsScript.src='/export-v6.js?v=20260914-2';
    exportsScript.onload=()=>{
      const v62=document.createElement('script');
      v62.src='/platform-v62-ui.js?v=20260914-2';
      v62.onload=()=>{
        const guard=document.createElement('script');
        guard.src='/chart-height-fix.js?v=20260914-2';
        guard.onload=()=>{
          const inventory=document.createElement('script');
          inventory.src='/device-inventory-v62.js?v=20260914-1';
          inventory.onload=()=>{
            const tcpInterfaces=document.createElement('script');
            tcpInterfaces.src='/tcp-interface-v62.js?v=20260914-1';
            document.body.appendChild(tcpInterfaces);
          };
          document.body.appendChild(inventory);
        };
        document.body.appendChild(guard);
      };
      document.body.appendChild(v62);
    };
    document.body.appendChild(exportsScript);
  };
  document.body.appendChild(main);
},{once:true});
