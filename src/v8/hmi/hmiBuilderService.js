'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');

const WIDGET_TYPES = Object.freeze(new Set([
  'numericDisplay', 'numericInput', 'lamp', 'switch', 'gauge', 'bar', 'trend',
  'text', 'stateLabel', 'image', 'bitfield', 'button',
]));
const WRITE_WIDGETS = Object.freeze(new Set(['numericInput', 'switch']));
const ACTION_WIDGETS = Object.freeze(new Set(['button']));
const MAX_SCREENS = 10000;
const MAX_WIDGETS_PER_SCREEN = 5000;
const MAX_TEMPLATES = 10000;

class HmiBuilderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HmiBuilderError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, HmiBuilderError);
  }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`; }
function finite(value, fallback, { min = -1e9, max = 1e9 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function integer(value, fallback, { min = 0, max = 65535 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function safeText(value, fallback = '', max = 500) { return String(value ?? fallback).slice(0, max); }

function normalizeGrid(input = {}) {
  const size = integer(input.size, 10, { min: 2, max: 100 });
  return Object.freeze({ size, snap: input.snap !== false, visible: input.visible !== false });
}

function snap(value, grid) {
  const n = finite(value, 0, { min: 0, max: 100000 });
  return grid.snap ? Math.round(n / grid.size) * grid.size : Math.round(n);
}

function normalizeBinding(input = null) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new HmiBuilderError('INVALID_BINDING', 'Widget binding must be an object');
  const connectionId = safeText(input.connectionId).trim();
  if (!connectionId) throw new HmiBuilderError('INVALID_BINDING', 'binding.connectionId is required');
  const functionCode = integer(input.functionCode, 3, { min: 1, max: 255 });
  if (![1, 2, 3, 4].includes(functionCode)) throw new HmiBuilderError('INVALID_BINDING', 'HMI read binding supports FC01..FC04', { functionCode });
  const dataType = safeText(input.dataType, functionCode <= 2 ? 'bool' : 'uint16', 32);
  const words = { bool: 1, uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2, uint64: 4, int64: 4, float64: 4 }[dataType];
  if (!words) throw new HmiBuilderError('INVALID_BINDING', `Unsupported HMI dataType ${dataType}`, { dataType });
  const quantity = functionCode <= 2 ? 1 : words;
  return Object.freeze({
    connectionId,
    unitId: integer(input.unitId, 1, { min: 1, max: 255 }),
    functionCode,
    address: integer(input.address, 0),
    quantity,
    dataType,
    byteOrder: input.byteOrder == null ? null : safeText(input.byteOrder).toUpperCase().replace(/[^A-Z]/g, ''),
    scale: finite(input.scale, 1),
    offset: finite(input.offset, 0),
    unit: safeText(input.unit, '', 80),
    precision: integer(input.precision, 2, { min: 0, max: 12 }),
    staleAfterMs: integer(input.staleAfterMs, 5000, { min: 100, max: 3600000 }),
  });
}

function normalizeWrite(input = null, type = '') {
  if (!WRITE_WIDGETS.has(type)) return null;
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const functionCode = type === 'switch' ? 5 : integer(src.functionCode, 6, { min: 5, max: 16 });
  if (type === 'numericInput' && ![6, 16].includes(functionCode)) throw new HmiBuilderError('INVALID_WRITE_BINDING', 'Numeric input write function must be FC06 or FC16');
  return Object.freeze({
    functionCode,
    address: src.address == null ? null : integer(src.address, 0),
    readBack: src.readBack !== false,
    autoLockMs: integer(src.autoLockMs, 10000, { min: 100, max: 60000 }),
  });
}

function normalizeAction(input = null, type = '') {
  if (!ACTION_WIDGETS.has(type)) return null;
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new HmiBuilderError('INVALID_ACTION', 'Widget action must be an object');
  const kind = safeText(input.kind, '', 40);
  if (!['recipe', 'screen'].includes(kind)) throw new HmiBuilderError('INVALID_ACTION', 'Button action kind must be recipe or screen', { kind });
  return Object.freeze({ kind, targetId: safeText(input.targetId).trim(), defaultConnectionId: safeText(input.defaultConnectionId).trim() || null });
}

function normalizeWidget(input, grid, index = 0) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HmiBuilderError('INVALID_WIDGET', 'Widget must be an object', { index });
  const type = safeText(input.type).trim();
  if (!WIDGET_TYPES.has(type)) throw new HmiBuilderError('INVALID_WIDGET_TYPE', `Unsupported HMI widget type ${type}`, { type });
  const widgetId = safeText(input.widgetId || input.id || uid('widget')).trim();
  const x = snap(input.x, grid);
  const y = snap(input.y, grid);
  const w = Math.max(grid.size, snap(input.w ?? input.width ?? 160, grid));
  const h = Math.max(grid.size, snap(input.h ?? input.height ?? 80, grid));
  return Object.freeze({
    widgetId,
    type,
    label: safeText(input.label, type, 200),
    x, y, w, h,
    z: integer(input.z, index, { min: 0, max: 100000 }),
    locked: Boolean(input.locked),
    hidden: Boolean(input.hidden),
    style: input.style && typeof input.style === 'object' && !Array.isArray(input.style) ? clone(input.style) : {},
    config: input.config && typeof input.config === 'object' && !Array.isArray(input.config) ? clone(input.config) : {},
    binding: normalizeBinding(input.binding),
    write: normalizeWrite(input.write, type),
    action: normalizeAction(input.action, type),
  });
}

function normalizeScreen(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HmiBuilderError('INVALID_SCREEN', 'HMI screen must be an object');
  const screenId = safeText(input.screenId || existing?.screenId || uid('screen')).trim();
  const grid = normalizeGrid(input.grid || existing?.grid || {});
  const widgetsInput = Array.isArray(input.widgets) ? input.widgets : (existing?.widgets || []);
  if (widgetsInput.length > MAX_WIDGETS_PER_SCREEN) throw new HmiBuilderError('WIDGET_LIMIT', `HMI screen exceeds ${MAX_WIDGETS_PER_SCREEN} widgets`);
  const widgets = widgetsInput.map((widget, index) => normalizeWidget(widget, grid, index));
  const ids = new Set();
  for (const widget of widgets) {
    if (ids.has(widget.widgetId)) throw new HmiBuilderError('DUPLICATE_WIDGET_ID', `Duplicate widget ID ${widget.widgetId}`);
    ids.add(widget.widgetId);
  }
  return Object.freeze({
    screenId,
    name: safeText(input.name ?? existing?.name, 'HMI Screen', 200),
    width: integer(input.width ?? existing?.width, 1280, { min: 320, max: 7680 }),
    height: integer(input.height ?? existing?.height, 720, { min: 240, max: 4320 }),
    background: safeText(input.background ?? existing?.background, '', 200),
    grid,
    mode: ['edit', 'preview', 'run'].includes(input.mode) ? input.mode : (existing?.mode || 'edit'),
    widgets,
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
}

function wordsToBuffer(values) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeUInt16BE(Number(value) & 0xFFFF, index * 2));
  return out;
}
function bufferToWords(buffer) {
  const values = [];
  for (let offset = 0; offset < buffer.length; offset += 2) values.push(buffer.readUInt16BE(offset));
  return values;
}

function decodeEngineering(values, binding) {
  if (binding.dataType === 'bool') return Boolean(values[0]);
  const bytes = wordsToBuffer(values.slice(0, binding.quantity));
  let raw;
  if (binding.dataType === 'uint16') raw = protocol.decodeInteger(bytes, { bits: 16, signed: false, order: binding.byteOrder });
  else if (binding.dataType === 'int16') raw = protocol.decodeInteger(bytes, { bits: 16, signed: true, order: binding.byteOrder });
  else if (binding.dataType === 'uint32') raw = protocol.decodeInteger(bytes, { bits: 32, signed: false, order: binding.byteOrder });
  else if (binding.dataType === 'int32') raw = protocol.decodeInteger(bytes, { bits: 32, signed: true, order: binding.byteOrder });
  else if (binding.dataType === 'uint64') raw = protocol.decodeInteger(bytes, { bits: 64, signed: false, order: binding.byteOrder });
  else if (binding.dataType === 'int64') raw = protocol.decodeInteger(bytes, { bits: 64, signed: true, order: binding.byteOrder });
  else if (binding.dataType === 'float32') raw = protocol.decodeFloat(bytes, { bits: 32, order: binding.byteOrder });
  else raw = protocol.decodeFloat(bytes, { bits: 64, order: binding.byteOrder });
  if (typeof raw === 'bigint') return raw.toString();
  return raw * binding.scale + binding.offset;
}

function encodeEngineering(value, binding) {
  if (binding.dataType === 'bool') return [Boolean(value)];
  if (binding.scale === 0) throw new HmiBuilderError('INVALID_SCALE', 'Cannot write through a zero scale');
  const engineering = Number(value);
  if (!Number.isFinite(engineering)) throw new HmiBuilderError('INVALID_WIDGET_VALUE', 'HMI write value must be finite', { value });
  const raw = (engineering - binding.offset) / binding.scale;
  let bytes;
  if (binding.dataType.startsWith('float')) bytes = protocol.encodeFloat(raw, { bits: binding.dataType === 'float32' ? 32 : 64, order: binding.byteOrder });
  else {
    const bits = Number(binding.dataType.match(/\d+/)?.[0] || 16);
    const signed = binding.dataType.startsWith('int');
    if (!Number.isInteger(raw)) throw new HmiBuilderError('INVALID_WIDGET_VALUE', 'Scaled integer write does not resolve to an exact integer', { value, raw });
    bytes = protocol.encodeIntegerExact(raw, { bits, signed, order: binding.byteOrder });
  }
  return bufferToWords(bytes);
}

class HmiBuilderService extends EventEmitter {
  constructor({ store, masterWorkspace, testCenter = null } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!masterWorkspace) throw new TypeError('masterWorkspace is required');
    this.store = store;
    this.masterWorkspace = masterWorkspace;
    this.testCenter = testCenter;
  }

  list(projectId = null) {
    const project = this._project(projectId);
    return Object.freeze((project.hmiScreens || []).map((screen) => Object.freeze(clone(screen))));
  }
  get(screenId, projectId = null) {
    const screen = this.list(projectId).find((entry) => entry.screenId === screenId);
    if (!screen) throw new HmiBuilderError('SCREEN_NOT_FOUND', `HMI screen ${screenId} was not found`, { screenId });
    return screen;
  }
  save(input, projectId = null) {
    const project = this._project(projectId);
    const screens = Array.isArray(project.hmiScreens) ? clone(project.hmiScreens) : [];
    const id = safeText(input?.screenId).trim();
    const index = id ? screens.findIndex((entry) => entry.screenId === id) : -1;
    const screen = normalizeScreen(input, index >= 0 ? screens[index] : null);
    if (index >= 0) screens[index] = screen; else screens.push(screen);
    if (screens.length > MAX_SCREENS) throw new HmiBuilderError('SCREEN_LIMIT', `HMI project exceeds ${MAX_SCREENS} screens`);
    this.store.updateProject(project.id, { hmiScreens: screens });
    this._emit('hmi.screen-saved', { projectId: project.id, screenId: screen.screenId });
    return this.get(screen.screenId, project.id);
  }
  remove(screenId, projectId = null) {
    const project = this._project(projectId);
    this.get(screenId, project.id);
    this.store.updateProject(project.id, { hmiScreens: (project.hmiScreens || []).filter((entry) => entry.screenId !== screenId) });
    this._emit('hmi.screen-removed', { projectId: project.id, screenId });
    return true;
  }
  listTemplates(projectId = null) {
    const project = this._project(projectId);
    return Object.freeze((project.hmiTemplates || []).map((entry) => Object.freeze(clone(entry))));
  }
  saveTemplate(input, projectId = null) {
    const project = this._project(projectId);
    const templates = Array.isArray(project.hmiTemplates) ? clone(project.hmiTemplates) : [];
    const templateId = safeText(input?.templateId || uid('hmi-template')).trim();
    const grid = normalizeGrid(input?.grid || {});
    const widgets = (Array.isArray(input?.widgets) ? input.widgets : []).map((widget, index) => normalizeWidget(widget, grid, index));
    const record = { templateId, name: safeText(input?.name, 'HMI Template', 200), grid, widgets, updatedAt: new Date().toISOString() };
    const index = templates.findIndex((entry) => entry.templateId === templateId);
    if (index >= 0) templates[index] = record; else templates.push(record);
    if (templates.length > MAX_TEMPLATES) throw new HmiBuilderError('TEMPLATE_LIMIT', `HMI project exceeds ${MAX_TEMPLATES} templates`);
    this.store.updateProject(project.id, { hmiTemplates: templates });
    return Object.freeze(clone(record));
  }
  applyTemplate(screenId, templateId, { x = 0, y = 0 } = {}, projectId = null) {
    const screen = clone(this.get(screenId, projectId));
    const template = this.listTemplates(projectId).find((entry) => entry.templateId === templateId);
    if (!template) throw new HmiBuilderError('TEMPLATE_NOT_FOUND', `HMI template ${templateId} was not found`, { templateId });
    const dx = snap(x, screen.grid); const dy = snap(y, screen.grid);
    const widgets = template.widgets.map((widget) => ({ ...widget, widgetId: uid('widget'), x: widget.x + dx, y: widget.y + dy }));
    return this.save({ ...screen, widgets: [...screen.widgets, ...widgets] }, projectId);
  }

  async readWidget(screenId, widgetId, projectId = null) {
    const widget = this._widget(screenId, widgetId, projectId);
    if (!widget.binding) throw new HmiBuilderError('WIDGET_NOT_BOUND', 'Widget has no Modbus binding', { screenId, widgetId });
    const result = await this.masterWorkspace.readOnce(widget.binding);
    const values = result.decoded?.values || [];
    const value = decodeEngineering(values, widget.binding);
    return Object.freeze({ screenId, widgetId, at: Date.now(), value, rawValues: Object.freeze([...values]), unit: widget.binding.unit, precision: widget.binding.precision, rttMs: result.rttMs, evidence: { requestRawHex: result.requestRawHex, responseRawHex: result.responseRawHex } });
  }

  async writeWidget(screenId, widgetId, { value, confirmation = null } = {}, projectId = null) {
    const widget = this._widget(screenId, widgetId, projectId);
    if (!WRITE_WIDGETS.has(widget.type)) throw new HmiBuilderError('WIDGET_NOT_WRITABLE', `Widget ${widgetId} is not a write widget`, { widgetId, type: widget.type });
    if (!widget.binding || !widget.write) throw new HmiBuilderError('WRITE_BINDING_REQUIRED', 'Write widget needs both read binding and write configuration');
    if (!confirmation?.confirmed) throw new HmiBuilderError('CONFIRMATION_REQUIRED', 'HMI write requires explicit confirmation');
    const address = widget.write.address == null ? widget.binding.address : widget.write.address;
    let functionCode = widget.write.functionCode;
    let writeValue = null; let values = null;
    if (widget.type === 'switch') {
      functionCode = 5;
      writeValue = Boolean(value);
    } else {
      const encoded = encodeEngineering(value, widget.binding);
      if (encoded.length === 1 && functionCode === 6) writeValue = encoded[0];
      else { functionCode = 16; values = encoded; }
    }
    const result = await this.masterWorkspace.writeOnce({
      connectionId: widget.binding.connectionId,
      unitId: widget.binding.unitId,
      functionCode,
      address,
      value: writeValue,
      values,
      confirmation: { confirmed: true, bulk: functionCode === 16 },
      readBack: widget.write.readBack,
      autoLockMs: widget.write.autoLockMs,
    });
    this._emit('hmi.widget-write', { screenId, widgetId, connectionId: widget.binding.connectionId, unitId: widget.binding.unitId, functionCode, address });
    return result;
  }

  async triggerWidget(screenId, widgetId, { confirmation = null, variables = {} } = {}, projectId = null) {
    const widget = this._widget(screenId, widgetId, projectId);
    if (widget.type !== 'button' || !widget.action) throw new HmiBuilderError('WIDGET_ACTION_REQUIRED', 'Button widget has no action', { widgetId });
    if (widget.action.kind === 'screen') return Object.freeze({ kind: 'screen', targetId: widget.action.targetId });
    if (!confirmation?.confirmed) throw new HmiBuilderError('CONFIRMATION_REQUIRED', 'Recipe trigger requires explicit confirmation');
    if (!this.testCenter) throw new HmiBuilderError('TEST_CENTER_UNAVAILABLE', 'Recipe runtime is unavailable');
    const project = this._project(projectId);
    const recipe = (project.testRecipes || []).find((entry) => entry.recipeId === widget.action.targetId || entry.id === widget.action.targetId || entry.name === widget.action.targetId);
    if (!recipe) throw new HmiBuilderError('RECIPE_NOT_FOUND', `Recipe ${widget.action.targetId} was not found`, { recipeId: widget.action.targetId });
    const result = await this.testCenter.runRecipe(recipe, { variables, defaultConnectionId: widget.action.defaultConnectionId });
    this._emit('hmi.recipe-triggered', { screenId, widgetId, recipeId: widget.action.targetId });
    return result;
  }

  _widget(screenId, widgetId, projectId) {
    const screen = this.get(screenId, projectId);
    const widget = screen.widgets.find((entry) => entry.widgetId === widgetId);
    if (!widget) throw new HmiBuilderError('WIDGET_NOT_FOUND', `HMI widget ${widgetId} was not found`, { screenId, widgetId });
    return widget;
  }
  _project(projectId) {
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    if (!project) throw new HmiBuilderError('PROJECT_NOT_FOUND', 'Active v8 project was not found', { projectId });
    return project;
  }
  _emit(type, details) {
    this.emit('event', createWorkbenchEvent({ type, source: 'hmi-builder', ownerMode: 'analyzer', details }));
  }
}

module.exports = {
  WIDGET_TYPES,
  WRITE_WIDGETS,
  HmiBuilderError,
  HmiBuilderService,
  normalizeScreen,
  normalizeWidget,
  decodeEngineering,
  encodeEngineering,
};
