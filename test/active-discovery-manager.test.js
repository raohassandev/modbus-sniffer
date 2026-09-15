'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {ActiveDiscoveryManager}=require('../src/activeDiscoveryManager');

test('active discovery manager publishes progress and completed summary',async()=>{
  const scanTcp=async({onProgress})=>{
    const a={unitId:1,responded:true,identificationSupported:true,objects:[{objectId:0,value:'ACME'}]};
    const b={unitId:2,responded:false,identificationSupported:null,objects:[]};
    onProgress({transport:'TCP',unitId:1,current:1,total:2,result:a});
    onProgress({transport:'TCP',unitId:2,current:2,total:2,result:b});
    return{transport:'TCP',results:[a,b],responding:[a],identified:[a]};
  };
  const manager=new ActiveDiscoveryManager({scanTcp,scanRtu:async()=>({results:[]})});
  const started=manager.start({transport:'TCP',host:'127.0.0.1',unitStart:1,unitEnd:2});
  assert.equal(started.state,'running');assert.equal(started.transport,'TCP');
  await manager.promise;
  const done=manager.status();assert.equal(done.state,'completed');assert.equal(done.running,false);assert.equal(done.summary.checked,2);assert.equal(done.summary.responding,1);assert.equal(done.summary.identified,1);assert.equal(done.summary.silent,1);assert.equal(done.progress.current,2);
});

test('active discovery manager rejects concurrent scans',async()=>{
  let release;
  const scanTcp=()=>new Promise(resolve=>{release=()=>resolve({transport:'TCP',results:[],responding:[],identified:[]});});
  const manager=new ActiveDiscoveryManager({scanTcp,scanRtu:scanTcp});
  manager.start({transport:'TCP'});
  assert.throws(()=>manager.start({transport:'RTU'}),e=>e.code==='DISCOVERY_BUSY');
  await Promise.resolve();
  assert.equal(typeof release,'function');
  release();await manager.promise;assert.equal(manager.status().state,'completed');
});

test('active discovery manager cancellation aborts the scanner and settles as cancelled',async()=>{
  const scanTcp=({signal})=>new Promise((resolve,reject)=>{const fail=()=>{const e=new Error('cancelled');e.code='DISCOVERY_CANCELLED';reject(e);};if(signal.aborted)return fail();signal.addEventListener('abort',fail,{once:true});});
  const manager=new ActiveDiscoveryManager({scanTcp,scanRtu:scanTcp});
  manager.start({transport:'TCP'});const cancelling=manager.cancel();assert.equal(cancelling.state,'cancelling');assert.equal(cancelling.cancelRequested,true);
  await manager.promise;const done=manager.status();assert.equal(done.state,'cancelled');assert.equal(done.running,false);assert.equal(done.error,null);
});
