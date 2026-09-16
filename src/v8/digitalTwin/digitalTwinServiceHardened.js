'use strict';

const base = require('./digitalTwinService');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class DigitalTwinService extends base.DigitalTwinService {
  applyWithPatch(twinId, patch = {}) {
    const project = this._project();
    const previousTwin = clone(this.get(twinId));
    this.retarget(twinId, patch);
    try {
      return this.apply(twinId);
    } catch (error) {
      try {
        this._replace(project, previousTwin);
      } catch (rollbackError) {
        throw new base.DigitalTwinError('TWIN_PATCH_ROLLBACK_FAILED', 'Digital twin apply failed and the previous twin configuration could not be restored', {
          twinId,
          applyErrorCode: error?.code || null,
          applyError: String(error?.message || error),
          rollbackErrorCode: rollbackError?.code || null,
          rollbackError: String(rollbackError?.message || rollbackError),
        });
      }
      throw error;
    }
  }

  apply(twinId) {
    const project = this._project();
    const twin = clone(this.get(twinId));
    if (!twin.target.connectionId) {
      throw new base.DigitalTwinError('TARGET_CONNECTION_REQUIRED', 'A target Simulator connection is required before applying a digital twin', { twinId });
    }

    const serverId = twin.target.serverId;
    let previousServer = null;
    let previousDevices = [];
    try {
      previousServer = clone(this.simulator.getServer(serverId));
    } catch (error) {
      if (error?.code !== 'SERVER_NOT_FOUND') throw error;
    }

    if (previousServer) {
      const previousTwinId = previousServer.metadata?.digitalTwin?.twinId || null;
      if (previousTwinId !== twinId) {
        throw new base.DigitalTwinError('TWIN_TARGET_CONFLICT', `Simulator server ${serverId} already exists and is not owned by this digital twin`, {
          twinId,
          serverId,
          existingTwinId: previousTwinId,
        });
      }
      if (typeof this.simulator.listDevices !== 'function') {
        throw new base.DigitalTwinError('TWIN_SNAPSHOT_UNAVAILABLE', 'Simulator device snapshot support is required for atomic digital-twin reapply', {
          twinId,
          serverId,
        });
      }
      previousDevices = clone(this.simulator.listDevices(serverId));
    }

    const restoreSimulator = () => {
      try {
        this.simulator.removeServer(serverId);
      } catch (error) {
        if (error?.code !== 'SERVER_NOT_FOUND') throw error;
      }
      if (!previousServer) return;
      this.simulator.saveServer(previousServer);
      for (const device of previousDevices) this.simulator.saveDevice(device);
    };

    try {
      if (previousServer) this.simulator.removeServer(serverId);

      this.simulator.saveServer({
        serverId,
        name: twin.name,
        connectionId: twin.target.connectionId,
        framing: twin.target.framing,
        receivePollMs: twin.target.receivePollMs,
        metadata: {
          digitalTwin: {
            twinId,
            sourceConnectionId: twin.source.connectionId,
            requiresApproval: true,
            approved: false,
            generatedAt: new Date().toISOString(),
          },
        },
      });

      for (const device of twin.devices) {
        this.simulator.saveDevice({
          ...device,
          metadata: {
            ...device.metadata,
            digitalTwin: { twinId, sourceConnectionId: twin.source.connectionId },
          },
          writableAreas: twin.safety.writableAreas,
        });
      }

      twin.status = 'applied-review-required';
      twin.safety.approved = false;
      twin.appliedAt = new Date().toISOString();
      twin.updatedAt = twin.appliedAt;
      this._replace(project, twin);
    } catch (error) {
      try {
        restoreSimulator();
      } catch (rollbackError) {
        throw new base.DigitalTwinError('TWIN_APPLY_ROLLBACK_FAILED', 'Digital twin apply failed and previous Simulator topology could not be restored', {
          twinId,
          serverId,
          applyErrorCode: error?.code || null,
          applyError: String(error?.message || error),
          rollbackErrorCode: rollbackError?.code || null,
          rollbackError: String(rollbackError?.message || rollbackError),
        });
      }
      throw error;
    }

    this._emit('digital-twin.applied', twin, { serverId, reviewRequired: true });
    return this.get(twinId);
  }
}

module.exports = {
  ...base,
  DigitalTwinService,
};
