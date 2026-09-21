'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { collectExportModel, buildWorkbook, flattenDiscovery, flattenAdoptions, safeName, csv, spreadsheetSafeText, excelValue } = require('../src/exportBundle');

function fixtureProject(){
  return {
    id:'p1',name:'Plant/AUX',site:'Lab',bus:'Mixed',
    channels:{
      'rtu:sn-a':{channelId:'rtu:sn-a',transport:'RTU',mode:'passive',name:'RS485 A',endpoint:'COM7',active:true},
      'tcp:proxy:b':{channelId:'tcp:proxy:b',transport:'TCP',mode:'proxy',name:'Gateway B',endpoint:'10.0.0.5:502',active:true}
    },
    devices:{
      'tcp:proxy:b|1':{deviceKey:'tcp:proxy:b|1',channelId:'tcp:proxy:b',unitId:1,name:'Inverter 1',manufacturer:'ACME',model:'X1',revision:'R2',identification:{vendorName:'ACME',modelName:'X1',revision:'R2'}}
    },
    discoveryRuns:[{
      id:'disc-1',jobId:'job-1',transport:'TCP',savedAt:'2026-09-15T00:00:00.000Z',completedAt:1000,target:{host:'10.0.0.5',port:502},
      results:[{unitId:1,responded:true,identificationSupported:true,avgRttMs:12,objects:[{objectId:0,value:'ACME'}],identification:{vendorName:'ACME',productCode:'PC1',modelName:'X1',revision:'R2'}}],
      adoptions:[{deviceKey:'tcp:proxy:b|1',channelId:'tcp:proxy:b',unitId:1,adoptedAt:'2026-09-15T00:01:00.000Z',overwriteExisting:false,overwrittenFields:[]}]
    }]
  };
}

function fixtureState(){
  const device={transport:'TCP',channelId:'tcp:proxy:b',deviceKey:'tcp:proxy:b|1',unitId:1,slaveId:1,status:'online',healthScore:99,requests:10,responses:10,timeouts:0,exceptions:0,registerCount:2,pollGroupCount:1,avgRttMs:11,p95RttMs:15,lastSeen:1000};
  return {
    getStatus:()=>({totals:{frames:20,requests:10,responses:10,timeouts:0,exceptions:0,noiseBytes:0,avgRttMs:11,p95RttMs:15},channels:[{channelId:'tcp:proxy:b',healthScore:99,requests:10,responses:10,timeouts:0,exceptions:0,avgRttMs:11,p95RttMs:15}]}),
    getAnalysis:()=>({healthScore:99,healthAggregation:'minimum-channel-score',rates:{timeoutRate:0,unmatchedResponseRate:0}}),
    getDevices:()=>[device],
    getPollGroups:()=>[{...device,functionCode:3,operation:'read',startAddress:100,endAddress:101,quantity:2,medianIntervalMs:1000,p95IntervalMs:1000,jitterPct:0}],
    getRegisters:()=>[{...device,functionCode:3,address:100,lastValue:1,lastHex:'0001',reads:10,writes:0,changes:1,pollIntervalMs:1000}],
    getTransactions:()=>[{id:1,timestamp:1000,...device,direction:'RESPONSE',functionCode:3,functionName:'Read Holding Registers',rttMs:11,rawHex:'0001000000060103'}],
    exportCapture:()=>({schemaVersion:2,transactions:[]})
  };
}

test('discovery export rows preserve source and adoption audit identity',()=>{
  const p=fixtureProject(),d=flattenDiscovery(p),a=flattenAdoptions(p);
  assert.equal(d.length,1);assert.equal(d[0].target,'10.0.0.5:502');assert.equal(d[0].adoptedDeviceKey,'tcp:proxy:b|1');assert.equal(d[0].vendorName,'ACME');
  assert.equal(a.length,1);assert.equal(a[0].channelId,'tcp:proxy:b');assert.equal(a[0].modelName,'X1');assert.equal(a[0].revision,'R2');
});

test('XLSX export contains transport-aware channel discovery and adoption sheets',async()=>{
  const project=fixtureProject(),state=fixtureState();
  const networkSnapshot={hosts:[{id:'mac:00:11:22:33:44:55',state:'online',ip:'10.0.0.5',mac:'00:11:22:33:44:55',macVendor:'ACME',hostname:'gateway',type:'Modbus Device',classification:'trusted',industrial:true,modbus:{verified:true},services:[{port:502,protocol:'tcp',name:'Modbus TCP'}],avgRttMs:4,firstSeen:'2026-09-15T00:00:00.000Z',lastSeen:'2026-09-15T00:01:00.000Z',lastChanged:'2026-09-15T00:01:00.000Z'}],events:[{at:'2026-09-15T00:01:00.000Z',type:'host-discovered',severity:'info',ip:'10.0.0.5',hostId:'mac:00:11:22:33:44:55',source:'network-scan'}],scans:[{id:'net-1'}]};
  const model=collectExportModel({project,state,diagnostics:{findings:[]},mappings:[{transport:'TCP',channelId:'tcp:proxy:b',deviceKey:'tcp:proxy:b|1',unitId:1,slaveId:1,functionCode:3,address:100,name:'Power',type:'uint16',byteOrder:'ABCD',scale:1,offset:0,unit:'kW',rawWords:[1],engineeringValue:1,available:true}],history:[],networkSnapshot});
  const buf=await buildWorkbook(model),wb=new ExcelJS.Workbook();await wb.xlsx.load(buf);
  for(const name of ['Summary','Channels','Devices','Polling Groups','Registers','Engineering Values','Timeouts','Exceptions','Traffic','Discovery','Adoption Audit','Project History','Network Hosts','Network Events'])assert.ok(wb.getWorksheet(name),`missing ${name}`);
  const devices=wb.getWorksheet('Devices');
  assert.deepEqual(devices.getRow(1).values.slice(1,6),['Transport','Channel','Endpoint','Device Key','Unit/Slave ID']);
  assert.equal(devices.getRow(2).getCell(1).value,'TCP');assert.equal(devices.getRow(2).getCell(2).value,'tcp:proxy:b');assert.equal(devices.getRow(2).getCell(4).value,'tcp:proxy:b|1');
  const discovery=wb.getWorksheet('Discovery');assert.equal(discovery.getRow(2).getCell(10).value,'ACME');
  const audit=wb.getWorksheet('Adoption Audit');assert.equal(audit.getRow(2).getCell(5).value,'tcp:proxy:b');
  const networkHosts=wb.getWorksheet('Network Hosts');
  assert.equal(networkHosts.getRow(2).getCell(2).value,'10.0.0.5');
  assert.equal(networkHosts.getRow(2).getCell(9).value,'verified');
});

test('safe export names handle Windows reserved names, separators, Unicode and length',()=>{
  assert.equal(safeName('CON'),'_CON');
  assert.equal(safeName('Plant/AUX: Test'),'Plant-AUX- Test');
  assert.equal(safeName('پلانٹ 1'),'پلانٹ 1');
  assert.ok(Array.from(safeName('x'.repeat(200))).length<=80);
});

test('CSV and XLSX text cells defang spreadsheet formulas without changing numeric values',async()=>{
  for(const dangerous of ['=1+1','+SUM(A1:A2)','-2+3','@SUM(A1:A2)','  =HYPERLINK("x")']){
    assert.ok(spreadsheetSafeText(dangerous).startsWith("'"),dangerous);
  }
  assert.equal(excelValue(-12),-12);
  const text=csv([{name:'=cmd|test',note:'safe'}],[{label:'name',value:x=>x.name},{label:'note',value:x=>x.note}]);
  assert.match(text,/\r\n'=cmd\|test,safe$/);

  const project=fixtureProject();project.devices['tcp:proxy:b|1'].name='=HYPERLINK("https://invalid")';
  const model=collectExportModel({project,state:fixtureState(),diagnostics:{findings:[]},mappings:[],history:[]});
  const buf=await buildWorkbook(model),wb=new ExcelJS.Workbook();await wb.xlsx.load(buf);
  const devices=wb.getWorksheet('Devices');
  assert.equal(devices.getRow(2).getCell(6).value,'\'=HYPERLINK("https://invalid")');
});
