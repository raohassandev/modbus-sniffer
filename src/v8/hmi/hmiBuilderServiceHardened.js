'use strict';

const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');
const base = require('./hmiBuilderService');

const INTEGER_TYPES_64 = new Set(['uint64', 'int64']);
const WORDS = Object.freeze({ bool: 1, uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2, uint64: 4, int64: 4, float64: 4 });

function strictInteger(value, field, { min, max }) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new base.HmiBuilderError('INVALID_BINDING', `${field} must be an integer in ${min}..${max}`, { field, value });
  }
  return numeric;
}

function strictFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new base.HmiBuilderError('INVALID_BINDING', `${field} must be finite`, { field, value });
  return numeric;
}

function normalizeDraftBinding(widget) {
  if (!widget || typeof widget !== 'object' || widget.binding == null) return widget;
  const binding = widget.binding;
  if (typeof binding !== 'object' || Array.isArray(binding)) return widget;
  if (!String(binding.connectionId || '').trim()) return { ...widget, binding: null };
  return widget;
}

function validateWidgetSafety(widget, index) {
  if (!widget || typeof widget !== 'object' || Array.isArray(widget)) return;
  const binding = widget.binding;
  if (binding != null) {
    if (typeof binding !== 'object' || Array.isArray(binding)) throw new base.HmiBuilderError('INVALID_BINDING', 'Widget binding must be an object', { index });
    const connectionId = String(binding.connectionId || '').trim();
    if (!connectionId) throw new base.HmiBuilderError('INVALID_BINDING', 'binding.connectionId is required', { index });
    const functionCode = strictInteger(binding.functionCode ?? 3, 'binding.functionCode', { min: 1, max: 4 });
    if (![1, 2, 3, 4].includes(functionCode)) throw new base.HmiBuilderError('INVALID_BINDING', 'HMI read binding supports FC01..FC04', { functionCode, index });
    strictInteger(binding.unitId ?? 1, 'binding.unitId', { min: 1, max: 255 });
    strictInteger(binding.address ?? 0, 'binding.address', { min: 0, max: 65535 });
    const dataType = String(binding.dataType || (functionCode <= 2 ? 'bool' : 'uint16'));
    const words = WORDS[dataType];
    if (!words) throw new base.HmiBuilderError('INVALID_BINDING', `Unsupported HMI dataType ${dataType}`, { dataType, index });
    if (functionCode <= 2 && dataType !== 'bool') throw new base.HmiBuilderError('INVALID_BINDING', 'FC01/FC02 HMI bindings must use bool dataType', { dataType, functionCode, index });
    if (functionCode >= 3 && dataType === 'bool') throw new base.HmiBuilderError('INVALID_BINDING', 'FC03/FC04 HMI bindings require a register dataType', { dataType, functionCode, index });
    strictFinite(binding.scale ?? 1, 'binding.scale');
    strictFinite(binding.offset ?? 0, 'binding.offset');
    strictInteger(binding.precision ?? 2, 'binding.precision', { min: 0, max: 12 });
    strictInteger(binding.staleAfterMs ?? 5000, 'binding.staleAfterMs', { min: 100, max: 3600000 });
    if (binding.byteOrder != null && dataType !== 'bool') {
      protocol.normalizeByteOrder(binding.byteOrder, words * 2);
    }
    if (widget.type === 'numericInput' && INTEGER_TYPES_64.has(dataType)) {
      throw new base.HmiBuilderError('INVALID_WRITE_BINDING', '64-bit integer HMI input is disabled to prevent JavaScript precision loss; use a guarded exact-value workflow instead', { dataType, index });
    }
  }

  if (widget.write != null) {
    if (!['numericInput', 'switch'].includes(widget.type)) throw new base.HmiBuilderError('INVALID_WRITE_BINDING', 'Only numericInput and switch widgets may define write configuration', { index, type: widget.type });
    const write = widget.write;
    if (typeof write !== 'object' || Array.isArray(write)) throw new base.HmiBuilderError('INVALID_WRITE_BINDING', 'Widget write configuration must be an object', { index });
    if (write.address != null) strictInteger(write.address, 'write.address', { min: 0, max: 65535 });
    strictInteger(write.autoLockMs ?? 10000, 'write.autoLockMs', { min: 100, max: 60000 });
    if (widget.type === 'numericInput') {
      const fc = strictInteger(write.functionCode ?? 6, 'write.functionCode', { min: 5, max: 16 });
      if (![6, 16].includes(fc)) throw new base.HmiBuilderError('INVALID_WRITE_BINDING', 'Numeric input write function must be FC06 or FC16', { functionCode: fc, index });
    }
  }

  if (widget.action != null) {
    if (widget.type !== 'button') throw new base.HmiBuilderError('INVALID_ACTION', 'Only button widgets may define an action', { index, type: widget.type });
    const action = widget.action;
    if (typeof action !== 'object' || Array.isArray(action)) throw new base.HmiBuilderError('INVALID_ACTION', 'Widget action must be an object', { index });
    if (!['recipe', 'screen'].includes(String(action.kind || ''))) throw new base.HmiBuilderError('INVALID_ACTION', 'Button action kind must be recipe or screen', { index, kind: action.kind });
    if (!String(action.targetId || '').trim()) throw new base.HmiBuilderError('INVALID_ACTION', 'Button action targetId is required', { index });
  }
}

function prepareScreenInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const next = { ...input };
  if (Array.isArray(input.widgets)) {
    next.widgets = input.widgets.map((item) => normalizeDraftBinding(item));
    next.widgets.forEach(validateWidgetSafety);
  }
  return next;
}

function prepareTemplateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const next = { ...input };
  if (Array.isArray(input.widgets)) {
    next.widgets = input.widgets.map((item) => normalizeDraftBinding(item));
    next.widgets.forEach(validateWidgetSafety);
  }
  return next;
}

class HmiBuilderService extends base.HmiBuilderService {
  save(input, projectId = null) {
    return super.save(prepareScreenInput(input), projectId);
  }

  saveTemplate(input, projectId = null) {
    return super.saveTemplate(prepareTemplateInput(input), projectId);
  }

  async writeWidget(screenId, widgetId, { value, confirmation = null } = {}, projectId = null) {
    const screen = this.get(screenId, projectId);
    const widget = screen.widgets.find((entry) => entry.widgetId === widgetId);
    const configuredFunctionCode = Number(widget?.write?.functionCode ?? 6);
    const wordCount = WORDS[String(widget?.binding?.dataType || 'uint16')] || 1;
    const effectiveFunctionCode = widget?.type === 'numericInput' && (configuredFunctionCode === 16 || wordCount > 1)
      ? 16
      : configuredFunctionCode;
    if (effectiveFunctionCode === 16 && confirmation?.bulk !== true) {
      throw new base.HmiBuilderError('BULK_CONFIRMATION_REQUIRED', 'FC16 HMI write requires an explicit bulk confirmation', {
        screenId,
        widgetId,
        configuredFunctionCode,
        effectiveFunctionCode,
      });
    }
    return super.writeWidget(screenId, widgetId, { value, confirmation }, projectId);
  }

  _emit(type, details) {
    const ownerMode = ['hmi.widget-write', 'hmi.recipe-triggered'].includes(type) ? 'master' : null;
    this.emit('event', createWorkbenchEvent({ type, source: 'hmi-builder', ownerMode, details }));
  }
}

module.exports = {
  ...base,
  HmiBuilderService,
  prepareScreenInput,
  prepareTemplateInput,
  validateWidgetSafety,
};
