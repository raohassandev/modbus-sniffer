'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { screens: [], screen: null, selectedId: null, mode: 'edit', timer: null, templates: [], polling: false, pollGeneration: 0 };
  const widgetTypes = ['numericDisplay','numericInput','lamp','switch','gauge','bar','trend','text','stateLabel','image','bitfield','button'];
  const multiWordTypes = new Set(['uint32','int32','float32','uint64','int64','float64']);

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status})`);
      error.code = payload?.error?.code || `HTTP_${response.status}`;
      throw error;
    }
    return payload;
  }

  function toast(message, kind = 'success') {
    const host = $('#toastHost'); if (!host) return;
    const node = document.createElement('div'); node.className = `toast ${kind}`; node.textContent = message; host.appendChild(node);
    setTimeout(() => node.remove(), 3500);
  }

  function install() {
    if ($('#workspace-hmi')) return;
    $('.workspace-host')?.insertAdjacentHTML('beforeend', `
      <section id="workspace-hmi" class="workspace" aria-labelledby="hmiTitle">
        <div class="workspace-header"><div><h1 id="hmiTitle">HMI Builder</h1><p>Design safe operator screens using the same Master write lock and audit path.</p></div><div class="toolbar"><button id="hmiRefresh" class="button secondary" type="button">Refresh</button><button id="hmiNewScreen" class="button primary" type="button">New screen</button><button id="hmiSave" class="button primary" type="button">Save</button></div></div>
        <div class="hmi-toolbar panel">
          <label class="field-inline"><span>Screen</span><select id="hmiScreenSelect"></select></label>
          <div class="segmented" role="group" aria-label="HMI mode"><button class="button secondary small" data-hmi-mode="edit" type="button">Edit</button><button class="button secondary small" data-hmi-mode="preview" type="button">Preview</button><button class="button secondary small" data-hmi-mode="run" type="button">Run</button></div>
          <label class="field-inline"><span>Widget</span><select id="hmiWidgetType">${widgetTypes.map((type) => `<option value="${type}">${type}</option>`).join('')}</select></label><button id="hmiAddWidget" class="button secondary" type="button">Add widget</button>
          <button id="hmiAlignLeft" class="button secondary" type="button">Align left</button><button id="hmiAlignTop" class="button secondary" type="button">Align top</button><button id="hmiDeleteWidget" class="button destructive" type="button">Delete widget</button>
        </div>
        <div class="hmi-builder-grid">
          <aside class="panel hmi-screen-panel"><h2>Screens</h2><div id="hmiScreenList" class="hmi-screen-list"></div><div class="hmi-template-tools"><h3>Templates</h3><select id="hmiTemplateSelect"></select><button id="hmiSaveTemplate" class="button secondary small" type="button">Save selection as template</button><button id="hmiApplyTemplate" class="button secondary small" type="button">Apply template</button></div></aside>
          <div class="panel hmi-canvas-panel"><div id="hmiCanvasViewport" class="hmi-canvas-viewport"><div id="hmiCanvas" class="hmi-canvas" tabindex="0" aria-label="HMI design canvas"></div></div><div id="hmiStatus" class="inline-message" role="status" aria-live="polite"></div></div>
          <aside class="panel hmi-properties"><h2>Properties</h2><div id="hmiNoSelection" class="empty-state"><p>Select a widget to edit it.</p></div><form id="hmiPropertiesForm" hidden>
            <label class="field"><span>Label</span><input id="hmiPropLabel" class="text-input"></label><div class="hmi-four"><label class="field"><span>X</span><input id="hmiPropX" class="text-input" type="number"></label><label class="field"><span>Y</span><input id="hmiPropY" class="text-input" type="number"></label><label class="field"><span>W</span><input id="hmiPropW" class="text-input" type="number"></label><label class="field"><span>H</span><input id="hmiPropH" class="text-input" type="number"></label></div>
            <label class="field"><span>Connection</span><input id="hmiPropConnection" class="text-input" placeholder="connectionId"></label><div class="hmi-four"><label class="field"><span>Unit</span><input id="hmiPropUnit" class="text-input" type="number" min="1" max="255"></label><label class="field"><span>FC</span><select id="hmiPropFc"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></label><label class="field"><span>Address</span><input id="hmiPropAddress" class="text-input" type="number" min="0" max="65535"></label><label class="field"><span>Type</span><select id="hmiPropDataType"><option>bool</option><option selected>uint16</option><option>int16</option><option>uint32</option><option>int32</option><option>float32</option><option>uint64</option><option>int64</option><option>float64</option></select></label></div>
            <div class="hmi-four"><label class="field"><span>Scale</span><input id="hmiPropScale" class="text-input" type="number" step="any"></label><label class="field"><span>Offset</span><input id="hmiPropOffset" class="text-input" type="number" step="any"></label><label class="field"><span>Unit text</span><input id="hmiPropUnitText" class="text-input"></label><label class="field"><span>Precision</span><input id="hmiPropPrecision" class="text-input" type="number" min="0" max="12"></label></div>
            <label class="field"><span>Config JSON</span><textarea id="hmiPropConfig" class="text-input hmi-json" spellcheck="false">{}</textarea></label><label class="field"><span>Style JSON</span><textarea id="hmiPropStyle" class="text-input hmi-json" spellcheck="false">{}</textarea></label>
            <div class="hmi-action-row"><button id="hmiApplyProperties" class="button primary" type="submit">Apply properties</button><button id="hmiLayerUp" class="button secondary" type="button">Layer +</button><button id="hmiLayerDown" class="button secondary" type="button">Layer −</button></div>
          </form></aside>
        </div>
      </section>`);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/v8/hmi-workspace.css'; document.head.appendChild(css);
  }

  function selected() { return state.screen?.widgets?.find((widget) => widget.widgetId === state.selectedId) || null; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function defaultWidget(type) {
    const id = `widget-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
    const base = { widgetId: id, type, label: type, x: 20, y: 20, w: type === 'trend' ? 400 : 180, h: type === 'trend' ? 220 : 90, z: state.screen?.widgets?.length || 0, config: {}, style: {} };
    if (['numericDisplay','numericInput','lamp','switch','gauge','bar','trend','stateLabel','bitfield'].includes(type)) base.binding = { connectionId: '', unitId: 1, functionCode: type === 'lamp' || type === 'switch' ? 1 : 3, address: 0, dataType: type === 'lamp' || type === 'switch' ? 'bool' : 'uint16', scale: 1, offset: 0, unit: '', precision: 2 };
    if (type === 'numericInput') base.write = { functionCode: 6, readBack: true, autoLockMs: 10000 };
    if (type === 'switch') base.write = { functionCode: 5, readBack: true, autoLockMs: 10000 };
    if (type === 'button') base.action = { kind: 'screen', targetId: '' };
    return base;
  }

  function renderScreenList() {
    const host = $('#hmiScreenList'); if (!host) return;
    host.replaceChildren(...state.screens.map((screen) => { const button = document.createElement('button'); button.type = 'button'; button.className = `hmi-screen-item${state.screen?.screenId === screen.screenId ? ' active' : ''}`; button.dataset.hmiScreen = screen.screenId; button.textContent = screen.name || screen.screenId; return button; }));
    const select = $('#hmiScreenSelect'); const current = state.screen?.screenId || '';
    select.replaceChildren(...state.screens.map((screen) => { const option = document.createElement('option'); option.value = screen.screenId; option.textContent = screen.name || screen.screenId; return option; }));
    if (current) select.value = current;
  }

  function widgetValue(widget) { return widget._value == null ? '—' : widget._value; }
  function renderWidget(widget) {
    const node = document.createElement('div'); node.className = `hmi-widget hmi-${widget.type}${widget.widgetId === state.selectedId ? ' selected' : ''}`; node.dataset.widgetId = widget.widgetId; node.style.left = `${widget.x}px`; node.style.top = `${widget.y}px`; node.style.width = `${widget.w}px`; node.style.height = `${widget.h}px`; node.style.zIndex = String(widget.z || 0);
    for (const [key, value] of Object.entries(widget.style || {})) if (/^(background|color|borderColor|borderRadius|fontSize|fontWeight|textAlign)$/.test(key)) node.style[key] = String(value);
    const label = document.createElement('div'); label.className = 'hmi-widget-label'; label.textContent = widget.label || widget.type; node.appendChild(label);
    const body = document.createElement('div'); body.className = 'hmi-widget-body';
    const value = widgetValue(widget);
    if (widget.type === 'lamp') { const lamp = document.createElement('span'); lamp.className = `hmi-lamp ${value === true || value === 1 ? 'on' : ''}`; const text = document.createElement('strong'); text.textContent = value === true || value === 1 ? 'ON' : 'OFF'; body.append(lamp, text); }
    else if (widget.type === 'switch') { const input = document.createElement('button'); input.type = 'button'; input.className = `button ${value ? 'primary' : 'secondary'} small`; input.textContent = value ? 'ON' : 'OFF'; input.dataset.hmiWrite = 'switch'; body.appendChild(input); }
    else if (widget.type === 'numericInput') { const input = document.createElement('input'); input.className = 'text-input hmi-run-input'; input.type = 'number'; input.step = 'any'; input.value = Number.isFinite(Number(value)) ? String(value) : ''; input.dataset.hmiWrite = 'number'; body.append(input); }
    else if (widget.type === 'gauge' || widget.type === 'bar') { const meter = document.createElement('meter'); meter.min = Number(widget.config?.min ?? 0); meter.max = Number(widget.config?.max ?? 100); meter.value = Number(value) || 0; body.append(meter); const text = document.createElement('strong'); text.textContent = `${value} ${widget.binding?.unit || ''}`; body.append(text); }
    else if (widget.type === 'trend') { body.classList.add('hmi-trend'); const history = Array.isArray(widget._history) ? widget._history : []; body.textContent = history.length ? history.slice(-12).map((item) => Number(item).toFixed(widget.binding?.precision ?? 2)).join(' · ') : 'Waiting for samples…'; }
    else if (widget.type === 'image') { const img = document.createElement('img'); img.alt = widget.label || 'HMI image'; img.src = String(widget.config?.src || ''); body.append(img); }
    else if (widget.type === 'bitfield') { const n = Number(value) || 0; body.textContent = Array.from({ length: Math.min(16, Number(widget.config?.bits || 8)) }, (_, bit) => `b${bit}:${(n >> bit) & 1}`).join('  '); }
    else if (widget.type === 'button') { const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary'; button.dataset.hmiTrigger = '1'; button.textContent = widget.config?.caption || widget.label || 'Action'; body.append(button); }
    else if (widget.type === 'stateLabel') { const states = widget.config?.states || {}; body.textContent = states[String(value)] ?? String(value); }
    else if (widget.type === 'text') body.textContent = String(widget.config?.text || widget.label || 'Text');
    else { const text = document.createElement('strong'); text.textContent = String(value); const unit = document.createElement('span'); unit.textContent = widget.binding?.unit || ''; body.append(text, unit); }
    node.appendChild(body); return node;
  }

  function renderCanvas() {
    const canvas = $('#hmiCanvas'); if (!canvas) return;
    if (!state.screen) { canvas.replaceChildren(); return; }
    canvas.style.width = `${state.screen.width}px`; canvas.style.height = `${state.screen.height}px`; canvas.style.backgroundColor = state.screen.background || '';
    canvas.style.setProperty('--hmi-grid', `${state.screen.grid?.size || 10}px`); canvas.classList.toggle('grid-visible', state.mode === 'edit' && state.screen.grid?.visible !== false); canvas.dataset.mode = state.mode;
    canvas.replaceChildren(...(state.screen.widgets || []).filter((w) => !w.hidden).sort((a,b) => (a.z||0)-(b.z||0)).map(renderWidget));
    $('#hmiStatus').textContent = `${state.screen.name} · ${state.screen.widgets?.length || 0} widgets · ${state.mode.toUpperCase()}`;
    refreshInspector();
  }

  function refreshInspector() {
    const widget = selected(); $('#hmiNoSelection').hidden = Boolean(widget); $('#hmiPropertiesForm').hidden = !widget; if (!widget) return;
    const set = (id, value) => { const node = $(id); if (node) node.value = value ?? ''; };
    set('#hmiPropLabel', widget.label); set('#hmiPropX', widget.x); set('#hmiPropY', widget.y); set('#hmiPropW', widget.w); set('#hmiPropH', widget.h);
    set('#hmiPropConnection', widget.binding?.connectionId || ''); set('#hmiPropUnit', widget.binding?.unitId ?? 1); set('#hmiPropFc', widget.binding?.functionCode ?? 3); set('#hmiPropAddress', widget.binding?.address ?? 0); set('#hmiPropDataType', widget.binding?.dataType || 'uint16'); set('#hmiPropScale', widget.binding?.scale ?? 1); set('#hmiPropOffset', widget.binding?.offset ?? 0); set('#hmiPropUnitText', widget.binding?.unit || ''); set('#hmiPropPrecision', widget.binding?.precision ?? 2); set('#hmiPropConfig', JSON.stringify(widget.config || {}, null, 2)); set('#hmiPropStyle', JSON.stringify(widget.style || {}, null, 2));
  }

  async function refresh() {
    const [screens, templates] = await Promise.all([api('/api/v8/hmi/screens'), api('/api/v8/hmi/templates')]); state.screens = screens.screens || []; state.templates = templates.templates || [];
    if (!state.screen && state.screens.length) state.screen = copy(state.screens[0]); else if (state.screen) { const latest = state.screens.find((s) => s.screenId === state.screen.screenId); if (latest && !state.dirty) state.screen = copy(latest); }
    renderScreenList(); const templateSelect = $('#hmiTemplateSelect'); templateSelect.replaceChildren(...state.templates.map((t) => { const o=document.createElement('option'); o.value=t.templateId; o.textContent=t.name||t.templateId; return o; })); renderCanvas();
  }

  async function save() { if (!state.screen) return; const result = await api(`/api/v8/hmi/screens/${encodeURIComponent(state.screen.screenId)}`, { method:'PUT', body:JSON.stringify({ ...state.screen, mode: state.mode }) }); state.screen = copy(result.screen); state.dirty = false; toast('HMI screen saved'); await refresh(); }
  async function newScreen() { const name = prompt('Screen name', 'Operator Screen'); if (!name) return; const result = await api('/api/v8/hmi/screens', { method:'POST', body:JSON.stringify({ name, width:1280, height:720, grid:{size:10,snap:true,visible:true}, widgets:[] }) }); state.screen = copy(result.screen); state.selectedId = null; state.dirty = false; await refresh(); }

  function markDirty() { state.dirty = true; $('#hmiStatus').textContent = 'Unsaved changes'; }
  function setMode(mode) { if (mode === 'run' && state.dirty) { toast('Save HMI changes before entering Run mode.', 'error'); return; } state.mode = mode; document.querySelectorAll('[data-hmi-mode]').forEach((b)=>b.classList.toggle('primary', b.dataset.hmiMode===mode)); if (mode === 'run') startPolling(); else stopPolling(); renderCanvas(); }
  function stopPolling(){ if(state.timer) clearTimeout(state.timer); state.timer=null; state.pollGeneration+=1; state.polling=false; }
  function startPolling(){ stopPolling(); const generation=state.pollGeneration; const tick=async()=>{ if(state.mode!=='run'||generation!==state.pollGeneration)return; if(state.polling)return; state.polling=true; try{await poll();}catch{/* individual widget errors are rendered by poll */}finally{state.polling=false;if(state.mode==='run'&&generation===state.pollGeneration)state.timer=setTimeout(tick,1000);} }; tick(); }
  async function poll(){ if(state.mode!=='run'||!state.screen)return; const activeScreen=state.screen; for(const widget of activeScreen.widgets||[]){ if(state.mode!=='run'||state.screen!==activeScreen)break; if(!widget.binding?.connectionId) continue; try{ const result=await api(`/api/v8/hmi/screens/${encodeURIComponent(activeScreen.screenId)}/widgets/${encodeURIComponent(widget.widgetId)}/read`,{method:'POST'}); if(state.screen!==activeScreen)break; widget._value=result.result.value; widget._history=[...(widget._history||[]).slice(-59),result.result.value]; }catch(error){ if(state.screen!==activeScreen)break; widget._value='ERR'; } } if(state.screen===activeScreen)renderCanvas(); }

  function applyInspector(event){ event.preventDefault(); const widget=selected(); if(!widget)return; try{ widget.label=$('#hmiPropLabel').value; widget.x=Number($('#hmiPropX').value)||0; widget.y=Number($('#hmiPropY').value)||0; widget.w=Math.max(10,Number($('#hmiPropW').value)||100); widget.h=Math.max(10,Number($('#hmiPropH').value)||50); widget.config=JSON.parse($('#hmiPropConfig').value||'{}'); widget.style=JSON.parse($('#hmiPropStyle').value||'{}'); const connectionId=$('#hmiPropConnection').value.trim(); if(connectionId){ widget.binding={ connectionId, unitId:Number($('#hmiPropUnit').value)||1, functionCode:Number($('#hmiPropFc').value)||3, address:Number($('#hmiPropAddress').value)||0, dataType:$('#hmiPropDataType').value, scale:Number($('#hmiPropScale').value), offset:Number($('#hmiPropOffset').value), unit:$('#hmiPropUnitText').value, precision:Number($('#hmiPropPrecision').value)||0 }; } else widget.binding=null; markDirty(); renderCanvas(); }catch(error){ toast(`Properties: ${error.message}`,'error'); } }

  function beginDrag(event){ if(state.mode!=='edit'||!state.screen)return; const node=event.target.closest('.hmi-widget'); if(!node)return; state.selectedId=node.dataset.widgetId; const widget=selected(); renderCanvas(); if(widget?.locked)return; const startX=event.clientX,startY=event.clientY,origX=widget.x,origY=widget.y; const move=(e)=>{ const grid=state.screen.grid?.snap!==false?(state.screen.grid?.size||10):1; widget.x=Math.max(0,Math.round((origX+e.clientX-startX)/grid)*grid); widget.y=Math.max(0,Math.round((origY+e.clientY-startY)/grid)*grid); node.style.left=`${widget.x}px`; node.style.top=`${widget.y}px`; markDirty(); }; const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);refreshInspector();}; window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true}); }

  install();
  $('#hmiRefresh')?.addEventListener('click',()=>refresh().catch((e)=>toast(e.message,'error'))); $('#hmiNewScreen')?.addEventListener('click',()=>newScreen().catch((e)=>toast(e.message,'error'))); $('#hmiSave')?.addEventListener('click',()=>save().catch((e)=>toast(e.message,'error')));
  $('#hmiScreenSelect')?.addEventListener('change',(e)=>{ const s=state.screens.find((x)=>x.screenId===e.target.value); if(s){state.screen=copy(s);state.selectedId=null;state.dirty=false;renderScreenList();renderCanvas();if(state.mode==='run')startPolling();}}); $('#hmiScreenList')?.addEventListener('click',(e)=>{const b=e.target.closest('[data-hmi-screen]');if(!b)return;$('#hmiScreenSelect').value=b.dataset.hmiScreen;$('#hmiScreenSelect').dispatchEvent(new Event('change'));});
  document.querySelectorAll('[data-hmi-mode]').forEach((button)=>button.addEventListener('click',()=>setMode(button.dataset.hmiMode)));
  $('#hmiAddWidget')?.addEventListener('click',()=>{if(!state.screen)return;const w=defaultWidget($('#hmiWidgetType').value);state.screen.widgets.push(w);state.selectedId=w.widgetId;markDirty();renderCanvas();});
  $('#hmiDeleteWidget')?.addEventListener('click',()=>{if(!state.screen||!state.selectedId)return;state.screen.widgets=state.screen.widgets.filter((w)=>w.widgetId!==state.selectedId);state.selectedId=null;markDirty();renderCanvas();});
  $('#hmiPropertiesForm')?.addEventListener('submit',applyInspector); $('#hmiLayerUp')?.addEventListener('click',()=>{const w=selected();if(w){w.z=(w.z||0)+1;markDirty();renderCanvas();}}); $('#hmiLayerDown')?.addEventListener('click',()=>{const w=selected();if(w){w.z=Math.max(0,(w.z||0)-1;markDirty();renderCanvas();}});
  $('#hmiAlignLeft')?.addEventListener('click',()=>{const w=selected();if(w){w.x=0;markDirty();renderCanvas();}}); $('#hmiAlignTop')?.addEventListener('click',()=>{const w=selected();if(w){w.y=0;markDirty();renderCanvas();}});
  $('#hmiCanvas')?.addEventListener('pointerdown',beginDrag); $('#hmiCanvas')?.addEventListener('click',async(e)=>{const node=e.target.closest('.hmi-widget');if(node&&state.mode==='edit'){state.selectedId=node.dataset.widgetId;renderCanvas();return;} if(state.mode!=='run'||!node)return; const widget=state.screen.widgets.find((w)=>w.widgetId===node.dataset.widgetId); if(!widget)return; try{if(e.target.closest('[data-hmi-write="switch"]')){if(!confirm(`Write ${widget.label}?`))return;await api(`/api/v8/hmi/screens/${encodeURIComponent(state.screen.screenId)}/widgets/${encodeURIComponent(widget.widgetId)}/write`,{method:'POST',body:JSON.stringify({value:!Boolean(widget._value),confirmation:{confirmed:true}})});}else if(e.target.matches('[data-hmi-write="number"]')){if(!confirm(`Write ${widget.label}?`))return;const bulk=widget.write?.functionCode===16||multiWordTypes.has(String(widget.binding?.dataType||''));if(bulk&&!confirm(`FC16 writes multiple registers for ${widget.label}. Confirm bulk write?`))return;await api(`/api/v8/hmi/screens/${encodeURIComponent(state.screen.screenId)}/widgets/${encodeURIComponent(widget.widgetId)}/write`,{method:'POST',body:JSON.stringify({value:Number(e.target.value),confirmation:{confirmed:true,...(bulk?{bulk:true}:{})}})});}else if(e.target.closest('[data-hmi-trigger]')){if(widget.action?.kind==='recipe'&&!confirm(`Run recipe ${widget.action.targetId}?`))return;const result=await api(`/api/v8/hmi/screens/${encodeURIComponent(state.screen.screenId)}/widgets/${encodeURIComponent(widget.widgetId)}/trigger`,{method:'POST',body:JSON.stringify({confirmation:{confirmed:true}})});if(result.result?.kind==='screen'){const target=state.screens.find((s)=>s.screenId===result.result.targetId);if(target){state.screen=copy(target);renderScreenList();renderCanvas();if(state.mode==='run')startPolling();}}}}catch(error){toast(error.message,'error');}});
  $('#hmiSaveTemplate')?.addEventListener('click',async()=>{const w=selected();if(!w)return toast('Select a widget first','error');const name=prompt('Template name',w.label||w.type);if(!name)return;await api('/api/v8/hmi/templates',{method:'POST',body:JSON.stringify({name,widgets:[w],grid:state.screen.grid})});await refresh();toast('Template saved');}); $('#hmiApplyTemplate')?.addEventListener('click',async()=>{if(!state.screen||!$('#hmiTemplateSelect').value)return;const result=await api(`/api/v8/hmi/screens/${encodeURIComponent(state.screen.screenId)}/templates/${encodeURIComponent($('#hmiTemplateSelect').value)}/apply`,{method:'POST',body:JSON.stringify({x:40,y:40})});state.screen=copy(result.screen);state.dirty=false;await refresh();});
  document.querySelector('#navList')?.addEventListener('click',(event)=>{const nav=event.target.closest('[data-workspace]');if(!nav)return;if(nav.dataset.workspace!=='hmi'){if(state.mode==='run')setMode('edit');else stopPolling();return;}queueMicrotask(()=>{document.querySelectorAll('.workspace').forEach((n)=>n.classList.remove('active'));$('#workspace-hmi')?.classList.add('active');refresh().catch((e)=>toast(e.message,'error'));});});
  setMode('edit'); refresh().catch(()=>undefined);
})();
