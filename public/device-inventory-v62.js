'use strict';

(()=>{
  const baseRenderStatus=renderStatus;
  renderStatus=function(){
    baseRenderStatus();
    const t=state.status?.totals||{};
    const confirmed=Number(t.confirmedDevices??t.devices??0);
    const observed=Number(t.observedUnitIds??confirmed);
    const online=Number(t.onlineDevices??confirmed);
    const silent=Number(t.silentDevices||0);
    const offline=Number(t.offlineDevices||0);
    const unconfirmed=Number(t.unconfirmedDevices??Math.max(0,observed-confirmed));
    const main=document.getElementById('kpiDevices'),sub=document.getElementById('kpiPolls');
    if(main){main.textContent=confirmed.toLocaleString();main.title='Confirmed Modbus devices: at least one valid response has been observed.';}
    if(sub){
      const parts=[`${online} online`];
      if(silent)parts.push(`${silent} silent`);
      if(offline)parts.push(`${offline} offline`);
      if(unconfirmed)parts.push(`${unconfirmed} unconfirmed`);
      sub.textContent=parts.join(' · ');
      sub.title=`${confirmed} confirmed device(s), ${observed} addressed Unit/Slave ID(s), ${unconfirmed} request-only/unconfirmed.`;
    }
  };

  const baseRenderDashboard=renderDashboard;
  renderDashboard=function(){
    baseRenderDashboard();
    const panel=document.getElementById('dashboardDevices')?.closest('.panel');
    const subtitle=panel?.querySelector('.panel-head p');
    if(subtitle)subtitle.textContent='Confirmed devices require a valid response; request-only Unit/Slave IDs are marked unconfirmed';
  };

  try{renderDashboard();}catch{}
})();
