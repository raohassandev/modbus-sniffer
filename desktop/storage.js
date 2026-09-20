'use strict';

const fs = require('fs');
const path = require('path');

function exists(p){try{return fs.existsSync(p);}catch{return false;}}
function mkdir(p){fs.mkdirSync(p,{recursive:true});return p;}
function isNonEmptyDir(p){try{return fs.statSync(p).isDirectory()&&fs.readdirSync(p).length>0;}catch{return false;}}
const MIGRATABLE_DATA=Object.freeze(['workspaces.json','workspaces.json.bak','master-monitor-sessions.json','history','logger-trend']);
function hasPersistedData(p){
  try{return fs.statSync(p).isDirectory()&&fs.readdirSync(p).some(name=>name!=='.desktop-storage-v2.json');}catch{return false;}
}
function copyTree(src,dst){
  if(!exists(src))return 0;
  let files=0;
  const stat=fs.statSync(src);
  if(stat.isDirectory()){
    mkdir(dst);
    for(const name of fs.readdirSync(src))files+=copyTree(path.join(src,name),path.join(dst,name));
    return files;
  }
  mkdir(path.dirname(dst));
  fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);
  return 1;
}

function findLegacyDataDir(candidates=[]){
  for(const candidate of candidates){
    if(!candidate)continue;
    const resolved=path.resolve(candidate);
    if(exists(path.join(resolved,'workspaces.json'))||exists(path.join(resolved,'workspaces.json.bak'))||exists(path.join(resolved,'master-monitor-sessions.json'))||isNonEmptyDir(path.join(resolved,'history'))||isNonEmptyDir(path.join(resolved,'logger-trend')))return resolved;
  }
  return null;
}

function prepareDesktopDataDir({userDataRoot,legacyCandidates=[],copyTreeImpl=copyTree}={}){
  if(!userDataRoot)throw new Error('Electron user-data directory is required.');
  const dataDir=path.join(path.resolve(userDataRoot),'data');
  mkdir(dataDir);
  const marker=path.join(dataDir,'.desktop-storage-v2.json');
  const destinationHasData=hasPersistedData(dataDir);
  let migrated=false,source=null,copiedFiles=0,error=null;

  // Never merge an old workspace into an already populated destination. Mixing two
  // stores is more dangerous than leaving the legacy copy untouched.
  if(!destinationHasData){
    source=findLegacyDataDir(legacyCandidates.filter(x=>x&&path.resolve(x)!==path.resolve(dataDir)));
    if(source){
      const migrationTargets=[];
      try{
        for(const name of MIGRATABLE_DATA){
          const from=path.join(source,name),to=path.join(dataDir,name);
          if(exists(from)&&!exists(to)){
            migrationTargets.push(to);
            copiedFiles+=copyTreeImpl(from,to);
          }
        }
        migrated=copiedFiles>0;
      }catch(e){
        // A failed recursive copy may already have created part of a top-level
        // workspace/history target. Roll back only targets this migration began,
        // so the next launch can retry without mixing partial legacy state.
        for(const target of migrationTargets.reverse()){
          try{fs.rmSync(target,{recursive:true,force:true});}catch{}
        }
        copiedFiles=0;
        error=e.message;
      }
    }
  }

  const report={version:2,preparedAt:new Date().toISOString(),dataDir,migrated,source,copiedFiles,error};
  try{fs.writeFileSync(marker,JSON.stringify(report,null,2));}catch{}
  if(error){const e=new Error(`Could not migrate legacy desktop data from ${source}: ${error}`);e.code='DESKTOP_DATA_MIGRATION_FAILED';e.report=report;throw e;}
  return report;
}

module.exports={prepareDesktopDataDir,findLegacyDataDir,copyTree,hasPersistedData};
