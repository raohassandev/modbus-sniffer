'use strict';

const { app, BrowserWindow, dialog, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
const { prepareDesktopDataDir } = require('./storage');

let backend = null;
let win = null;
let port = null;
let quitInProgress = false;
let allowFinalQuit = false;

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

function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address()?.port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

function startBackend(dataDir, selectedPort) {
  const root = backendRoot();
  const entry = path.join(root, 'src', 'index-v6.js');
  const args = [
    entry,
    '--web-port', String(selectedPort),
    '--web-host', '127.0.0.1',
    '--data-dir', dataDir
  ];
  backend = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  backend.stdout?.on('data', b => console.log(String(b).trim()));
  backend.stderr?.on('data', b => console.error(String(b).trim()));
  backend.on('exit', code => {
    backend = null;
    if (code && win && !win.isDestroyed() && !quitInProgress) dialog.showErrorBox('Analyzer backend stopped', `Backend exited with code ${code}`);
  });
}

function waitReady(selectedPort, retries = 80) {
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`http://127.0.0.1:${selectedPort}/api/status`, res => {
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

function terminateBackend() {
  return new Promise(resolve => {
    const child = backend;
    if (!child || child.killed || child.exitCode != null) { backend = null; resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; backend = null; resolve(); };
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (done || child.exitCode != null) return finish();
      if (process.platform === 'win32') {
        try {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
          killer.once('exit', () => setTimeout(finish, 100));
          killer.once('error', finish);
        } catch { finish(); }
      } else {
        try { child.kill('SIGKILL'); } catch {}
        setTimeout(finish, 100);
      }
    }, 1500).unref?.();
  });
}

function backgroundColor() { return nativeTheme.shouldUseDarkColors ? '#0b1017' : '#f4f7fb'; }

function lockNavigation(window, selectedPort) {
  const allowed = `http://127.0.0.1:${selectedPort}`;
  window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(allowed)) event.preventDefault();
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

  try { port = await chooseFreePort(); }
  catch (error) {
    dialog.showErrorBox('Startup error', `Could not allocate a local backend port: ${error.message}`);
    app.quit();
    return;
  }

  startBackend(storage.dataDir, port);
  try { await waitReady(port); }
  catch (error) {
    await terminateBackend();
    dialog.showErrorBox('Startup error', error.message);
    app.quit();
    return;
  }

  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: backgroundColor(),
    webPreferences: { nodeIntegration:false, contextIsolation:true, sandbox:true }
  });
  lockNavigation(win, port);
  nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(backgroundColor()); });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(create);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (allowFinalQuit || !backend) return;
  event.preventDefault();
  if (quitInProgress) return;
  quitInProgress = true;
  terminateBackend().finally(() => {
    allowFinalQuit = true;
    app.quit();
  });
});
