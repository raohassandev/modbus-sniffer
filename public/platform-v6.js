'use strict';

window.addEventListener('DOMContentLoaded',()=>{
  const main=document.createElement('script');
  main.src='/platform-v62-main.js?v=20260914-1';
  main.onload=()=>{
    const exportsScript=document.createElement('script');
    exportsScript.src='/export-v6.js?v=20260912';
    exportsScript.onload=()=>{
      const v62=document.createElement('script');
      v62.src='/platform-v62-ui.js?v=20260914-1';
      document.body.appendChild(v62);
    };
    document.body.appendChild(exportsScript);
  };
  document.body.appendChild(main);
},{once:true});
