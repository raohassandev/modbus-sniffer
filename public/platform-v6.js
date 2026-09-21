'use strict';

window.addEventListener('DOMContentLoaded',()=>{
  const reportAssetFailure=(url)=>{
    if(document.getElementById('platformAssetFailure'))return;
    const banner=document.createElement('div');
    banner.id='platformAssetFailure';
    banner.setAttribute('role','alert');
    banner.style.cssText='position:fixed;z-index:99999;left:12px;right:12px;bottom:12px;padding:12px 14px;border:1px solid #ef4444;border-radius:8px;background:#450a0a;color:#fee2e2;font:600 12px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)';
    banner.textContent='Modbus Engineering Tool could not load a required UI asset: '+String(url||'unknown')+'. Restart the app; if this repeats, verify the installation files.';
    document.body.appendChild(banner);
  };
  window.addEventListener('error',event=>{
    const target=event.target;
    if(target&&((typeof HTMLScriptElement!=='undefined'&&target instanceof HTMLScriptElement)||(typeof HTMLLinkElement!=='undefined'&&target instanceof HTMLLinkElement))){
      reportAssetFailure(target.src||target.href||'unknown');
    }
  },true);
  for(const href of ['/platform-v62.css?v=20260914-2','/chart-height-fix.css?v=20260914-1','/device-inventory-v62.css?v=20260914-1','/discovery-v63.css?v=20260915-1','/active-discovery-v7.css?v=20260915-1','/intelligence-v7.css?v=20260914-1','/master-v7.css?v=20260917-1','/master-sessions-v7.css?v=20260917-1','/master-register-meta-v7.css?v=20260918-1','/slave-v7.css?v=20260918-1','/master-write-v7.css?v=20260918-1','/master-advanced-v7.css?v=20260918-1','/device-clone-v7.css?v=20260918-1','/test-sequences-v7.css?v=20260918-1','/traffic-evidence-v7.css?v=20260918-1','/protocol-diagnostics-v7.css?v=20260918-1','/data-lab-v7.css?v=20260918-1','/logger-trend-v7.css?v=20260918-1','/compare-v7.css?v=20260918-1','/transport-lab-v7.css?v=20260918-1','/raw-lab-v7.css?v=20260918-1','/discovery-engineering-v7.css?v=20260918-1','/network-discovery-v8.css?v=20260921-1','/slave-lab-v7.css?v=20260918-1','/navigation-v7.css?v=20260918-1','/help-v7.css?v=20260918-1']){
    if(document.querySelector(`link[href="${href}"]`))continue;
    const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);
  }


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
            tcpInterfaces.onload=()=>{
              const discovery=document.createElement('script');
              discovery.src='/discovery-v63.js?v=20260915-1';
              discovery.onload=()=>{
                const activeDiscovery=document.createElement('script');
                activeDiscovery.src='/active-discovery-v7.js?v=20260915-1';
                activeDiscovery.onload=()=>{
                  const intelligence=document.createElement('script');
                  intelligence.src='/intelligence-v7.js?v=20260914-1';
                  intelligence.onload=()=>{
                    const master=document.createElement('script');
                    master.src='/master-v7.js?v=20260917-1';
                    master.onload=()=>{
                      const slave=document.createElement('script');
                      slave.src='/slave-v7.js?v=20260918-1';
                      slave.onload=()=>{
                        const clone=document.createElement('script');
                        clone.src='/device-clone-v7.js?v=20260918-1';
                        clone.onload=()=>{
                          const sequences=document.createElement('script');
                          sequences.src='/test-sequences-v7.js?v=20260918-1';
                          sequences.onload=()=>{
                            const evidence=document.createElement('script');
                            evidence.src='/traffic-evidence-v7.js?v=20260918-1';
                            evidence.onload=()=>{
                              const protocolDiagnostics=document.createElement('script');
                              protocolDiagnostics.src='/protocol-diagnostics-v7.js?v=20260918-1';
                              protocolDiagnostics.onload=()=>{
                                const dataLab=document.createElement('script');
                                dataLab.src='/data-lab-v7.js?v=20260918-1';
                                dataLab.onload=()=>{
                                  const loggerTrend=document.createElement('script');
                                  loggerTrend.src='/logger-trend-v7.js?v=20260918-1';
                                  loggerTrend.onload=()=>{
                                    const compare=document.createElement('script');
                                    compare.src='/compare-v7.js?v=20260918-1';
                                    compare.onload=()=>{
                                      const transportLab=document.createElement('script');
                                      transportLab.src='/transport-lab-v7.js?v=20260918-1';
                                      transportLab.onload=()=>{
                                        const rawLab=document.createElement('script');
                                        rawLab.src='/raw-lab-v7.js?v=20260918-1';
                                        rawLab.onload=()=>{
                                          const discoveryEngineering=document.createElement('script');
                                          discoveryEngineering.src='/discovery-engineering-v7.js?v=20260918-1';
                                          discoveryEngineering.onload=()=>{
                                            const networkDiscovery=document.createElement('script');
                                            networkDiscovery.src='/network-discovery-v8.js?v=20260921-1';
                                            networkDiscovery.onload=()=>{
                                              const slaveLab=document.createElement('script');
                                              slaveLab.src='/slave-lab-v7.js?v=20260918-1';
                                              slaveLab.onload=()=>{
                                              const help=document.createElement('script');
                                              help.src='/help-v7.js?v=20260918-1';
                                              help.onload=()=>{
                                                const navigation=document.createElement('script');
                                                navigation.src='/navigation-v7.js?v=20260918-1';
                                                document.body.appendChild(navigation);
                                              };
                                              document.body.appendChild(help);
                                              };
                                              document.body.appendChild(slaveLab);
                                            };
                                            document.body.appendChild(networkDiscovery);
                                          };
                                          document.body.appendChild(discoveryEngineering);
                                        };
                                        document.body.appendChild(rawLab);
                                      };
                                      document.body.appendChild(transportLab);
                                    };
                                    document.body.appendChild(compare);
                                  };
                                  document.body.appendChild(loggerTrend);
                                };
                                document.body.appendChild(dataLab);
                              };
                              document.body.appendChild(protocolDiagnostics);
                            };
                            document.body.appendChild(evidence);
                          };
                          document.body.appendChild(sequences);
                        };
                        document.body.appendChild(clone);
                      };
                      document.body.appendChild(slave);
                      const format=document.createElement('script');
                      format.src='/master-format-v7.js?v=20260917-1';
                      format.onload=()=>{
                        const sessions=document.createElement('script');
                        sessions.src='/master-sessions-v7.js?v=20260917-1';
                        sessions.onload=()=>{
                          const registerMeta=document.createElement('script');
                          registerMeta.src='/master-register-meta-v7.js?v=20260918-1';
                          registerMeta.onload=()=>{
                            const masterWrite=document.createElement('script');
                            masterWrite.src='/master-write-v7.js?v=20260918-1';
                            masterWrite.onload=()=>{
                              const advanced=document.createElement('script');
                              advanced.src='/master-advanced-v7.js?v=20260918-1';
                              document.body.appendChild(advanced);
                            };
                            document.body.appendChild(masterWrite);
                          };
                          document.body.appendChild(registerMeta);
                        };
                        document.body.appendChild(sessions);
                      };
                      document.body.appendChild(format);
                    };
                    document.body.appendChild(master);
                  };
                  document.body.appendChild(intelligence);
                };
                document.body.appendChild(activeDiscovery);
              };
              document.body.appendChild(discovery);
            };
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