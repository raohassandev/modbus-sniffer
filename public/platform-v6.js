'use strict';

window.addEventListener('DOMContentLoaded',()=>{
  const main=document.createElement('script');
  main.src='/platform-v6-main.js?v=20260912-2';
  main.onload=()=>{
    const exportsScript=document.createElement('script');
    exportsScript.src='/export-v6.js?v=20260912';
    document.body.appendChild(exportsScript);
  };
  document.body.appendChild(main);
},{once:true});
