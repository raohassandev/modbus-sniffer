'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeConnectionProfile, sanitizePersistedMetadata } = require('../src/v8/project/schema');
const { V8ProjectStore } = require('../src/v8/project');
const { ConnectionBroker } = require('../src/v8/connectionBroker');
const { ConnectionCenterServiceV8 } = require('../src/v8/connectionCenterServiceRelease');

test('v8 persisted connection metadata keeps TLS path references but strips credential material', () => {
  const profile = sanitizeConnectionProfile({
    connectionId: 'tls-profile',
    transportKind: 'tls-client',
    serial: { path: '/dev/ttyUSB0', password: 'serial-secret' },
    tcp: { host: '10.0.0.5', port: 502, accessToken: 'tcp-secret' },
    metadata: {
      transportOptions: {
        tls: {
          caPath: '/certs/ca.pem',
          certPath: '/certs/client.pem',
          keyPath: '/certs/client.key',
          privateKeyPem: '-----BEGIN PRIVATE KEY-----SECRET',
          passphrase: 'password',
        },
      },
      token: 'top-secret',
      nested: { clientSecret: 'nested-secret', note: 'retain-me' },
    },
  });

  const tls = profile.metadata.transportOptions.tls;
  assert.equal(tls.caPath, '/certs/ca.pem');
  assert.equal(tls.certPath, '/certs/client.pem');
  assert.equal(tls.keyPath, '/certs/client.key');
  assert.equal('privateKeyPem' in tls, false);
  assert.equal('passphrase' in tls, false);
  assert.equal('token' in profile.metadata, false);
  assert.equal('clientSecret' in profile.metadata.nested, false);
  assert.equal(profile.metadata.nested.note, 'retain-me');
  assert.equal(profile.serial.path, '/dev/ttyUSB0');
  assert.equal('password' in profile.serial, false);
  assert.equal(profile.tcp.host, '10.0.0.5');
  assert.equal('accessToken' in profile.tcp, false);
});

test('v8 normal profile save cannot persist arbitrary credential metadata', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-secret-persist-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  const center = new ConnectionCenterServiceV8({ store, broker });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));

  center.saveProfile({
    connectionId: 'safe-virtual',
    transportKind: 'virtual',
    metadata: { password: 'nope', nested: { accessToken: 'nope-too', label: 'kept' } },
  });
  const saved = store.listConnectionProfiles(store.getActiveProject().id)[0];
  assert.equal('password' in saved.metadata, false);
  assert.equal('accessToken' in saved.metadata.nested, false);
  assert.equal(saved.metadata.nested.label, 'kept');
});

test('v8 persisted metadata has a finite nesting limit', () => {
  let metadata = { value: 1 };
  for (let index = 0; index < 34; index += 1) metadata = { nested: metadata };
  assert.throws(
    () => sanitizePersistedMetadata(metadata),
    (error) => error.code === 'METADATA_DEPTH_LIMIT' && error.details?.maxDepth === 32,
  );
});
