'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { prepareDesktopDataDir } = require('./storage');

let backend = null;
let win = null;
const PORT = 8787;

function backendRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(__dirname, '..');
}

function prepareData() {
  const root = backendRoot();
  const userDataRoot = app.getPath('userData');
  const legacyCandidates = [
    path.join(root, 'data'),
    // Some older packaged builds could resolve cwd at the resources root rather than
    // the backend subfolder. Preserve that possibility without ever merging stores.
    app.isPackaged ? path.join(process.resourcesPath, 'data') : null,
    !app.isPackaged ? path.resolve(__dirname, '..', 'data') : null
  ];
  return prepareDesktopDataDir({ userDataRoot, legacyCandidates });
}

function startBackend(dataDir) {
  const root = backendRoot();
  const entry = path.join(root, 'src', 'index-v6.js');
  const args = [
    entry,
    '--web-port', String(PORT),
    '--web-host', '127.0.0.1',
    '--data-dir', dataDir
  ];
  backend = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  backend.stdout?.on('data', b => console.log(String(b).trim()));
  backend.stderr?.on('data', b => console.error(String(b).trim()));
  backend.on('exit', code => {
    if (code && win && !win.isDestroyed()) dialog.showErrorBox('Analyzer backend stopped', `Backend exited with code ${code}`);
  });
}

function waitReady(retries = 80) {
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/status`, res => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
        else if (--retries <= 0) reject(new Error(`Backend health check returned HTTP ${res.statusCode}.`));
        else setTimeout(ping, 250);
      });
      req.on('error', () => {
        if (--retries <= 0) reject(new Error('Backend did not start.'));
        else setTimeout(ping, 250);
      });
      req.setTimeout(500, () => req.destroy());
    };
    ping();
  });
}

async function create() {
  let storage;
  try { storage = prepareData(); }
  catch (error) {
    dialog.showErrorBox('Storage migration error', `${error.message}\n\nThe legacy data was left untouched. Resolve the storage issue before starting the analyzer.`);
    app.quit();
    return;
  }

  startBackend(storage.dataDir);
  try { await waitReady(); }
  catch (error) {
    dialog.showErrorBox('Startup error', error.message);
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b1017',
    webPreferences: { nodeIntegration:false, contextIsolation:true, sandbox:true }
  });
  await win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (backend && !backend.killed) backend.kill(); });
