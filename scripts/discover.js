'use strict';

const {scanTcpDeviceIds,scanRtuDeviceIds}=require('../src/activeDiscovery');

function args(argv){const out={mode:null};for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')&&!out.mode){out.mode=a.toLowerCase();continue;}const key=a.replace(/^--/,'');if(['maintenance','exclusive','json'].includes(key)){out[key]=true;continue;}out[key]=argv[++i];}return out;}
function num(v,d){const n=Number(v);return Number.isFinite(n)?n:d;}
function usage(){return `Read-only Modbus Device Identification discovery\n\nTCP:\n  npm run discover -- tcp --host 192.168.1.50 --port 502 --start 1 --end 20\n\nRTU (maintenance/exclusive bus only):\n  npm run discover -- rtu --port COM7 --baud 9600 --parity none --start 1 --end 20 --maintenance --exclusive\n\nOptions:\n  --timeout <ms>       response timeout\n  --delay <ms>         inter-request delay\n  --code <1..4>        Read Device Identification code (default 1/basic)\n  --json               print full JSON result\n\nDiscovery sends FC43/MEI 0x0E only. It never sends Modbus write functions.`;}
function brief(r,transport){const name=[r.identification?.vendorName,r.identification?.productCode,r.identification?.modelName,r.identification?.revision].filter(Boolean).join(' · ');return `${transport==='TCP'?'Unit':'Slave'} ${String(r.unitId).padStart(3)}  ${r.responded?'RESP':'----'}  ${r.identificationSupported===false?'FC43 unsupported':name|| (r.responded?'responded, no ID objects':'silent')}`;}

(async()=>{
  const a=args(process.argv.slice(2));if(!['tcp','rtu'].includes(a.mode)){console.log(usage());process.exitCode=2;return;}
  const common={unitStart:num(a.start,1),unitEnd:num(a.end,247),timeoutMs:num(a.timeout,a.mode==='tcp'?750:500),interRequestMs:num(a.delay,a.mode==='tcp'?75:100),readDeviceIdCode:num(a.code,1),onProgress:p=>{if(!a.json)console.log(brief(p.result,p.transport));}};
  let result;
  if(a.mode==='tcp')result=await scanTcpDeviceIds({...common,host:a.host,port:num(a.port,502)});
  else result=await scanRtuDeviceIds({...common,port:a.port,baudRate:num(a.baud,9600),dataBits:num(a.dataBits,8),stopBits:num(a.stopBits,1),parity:a.parity||'none',maintenanceConfirmed:Boolean(a.maintenance),exclusiveBusConfirmed:Boolean(a.exclusive)});
  if(a.json)console.log(JSON.stringify(result,null,2));
  else console.log(`\nDiscovery complete: ${result.responding.length} responding, ${result.identified.length} identified, ${result.results.length} addresses checked.`);
})().catch(e=>{console.error(`Discovery failed: ${e.message}`);if(e.code)console.error(`Code: ${e.code}`);process.exitCode=1;});
