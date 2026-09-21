'use strict';

const path = require('node:path');
const base = require('./historyWorkspaceService');
const { ChartService } = require('./chartService');
const { RotatingJsonlLogger } = require('./loggerService');
const { SqliteHistorian, sqliteAvailable } = require('./sqliteHistorian');

function safeProjectId(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw new base.HistoryWorkspaceError('INVALID_ID', 'ID must contain only letters, digits, dot, underscore, colon or dash');
  }
  return text;
}

class HistoryWorkspaceService extends base.HistoryWorkspaceService {
  _createRuntime(project, signature) {
    const charts = new ChartService();
    for (const definition of project.charts || []) {
      const chart = base.normalizeChart(definition);
      charts.createDocument(chart);
      for (const series of chart.series) charts.addSeries(chart.documentId, { ...series, source: { sourceKey: series.sourceKey } });
    }

    const projectId = safeProjectId(project.id);
    const logger = new RotatingJsonlLogger({ directory: path.join(this.dataDir, 'v8-logs', projectId), prefix: projectId, immediateFlush: false });
    const historianProfiles = [];
    for (const definition of project.loggerProfiles || []) {
      const profile = base.normalizeLogger(definition);
      logger.addStream({ streamId: profile.streamId, source: { sourceKey: profile.sourceKey }, mode: profile.mode, intervalMs: profile.intervalMs });
      if (!profile.enabled) logger.updateStream(profile.streamId, { enabled: false });
      if (profile.historian) historianProfiles.push(profile);
    }

    let historian = null;
    if (historianProfiles.length && sqliteAvailable()) {
      historian = new SqliteHistorian({ filePath: path.join(this.dataDir, 'v8-history', `${projectId}.sqlite`) });
      for (const profile of historianProfiles) {
        historian.upsertTag({ tagId: profile.streamId, name: profile.label, unit: profile.unit, source: { sourceKey: profile.sourceKey } });
      }
    }
    return { projectId: project.id, signature, charts, logger, historian };
  }

  snapshot(projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const runtime = this._runtime(project);
    const configured = (project.loggerProfiles || []).some((profile) => base.normalizeLogger(profile).historian);
    return Object.freeze({
      projectId: project.id,
      sqliteAvailable: sqliteAvailable(),
      charts: Object.freeze((project.charts || []).map((chart) => this._chartView(runtime, chart))),
      loggerProfiles: Object.freeze((project.loggerProfiles || []).map((profile) => Object.freeze({ ...profile }))),
      logger: runtime.logger.status(),
      historian: runtime.historian ? runtime.historian.status() : Object.freeze({ available: false, reason: configured ? 'node:sqlite unavailable in this runtime' : 'historian not configured' }),
    });
  }
}

module.exports = { ...base, HistoryWorkspaceService };
