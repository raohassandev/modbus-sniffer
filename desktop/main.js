'use strict';

const { app, BrowserWindow, dialog, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { prepareDesktopDataDir } = require('./storage');

let backend = null;
let win = null;
let port = null;
let quitInProgress = false;
let allowFinalQuit = false;
let desktopLogPath = null;

function redactLogSecrets(message) {
  let text = String(message || '');
  text = text.replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]');
  text = text.replace(/("(?:password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|key[_-]?path)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"');
  text = text.replace(/\b(password|passphrase|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|key[_-]?path)\s*=\s*([^\s,;]+)/gi, '$1=[REDACTED]');
  return text;
}

function appendDesktopLog(level, message) {
  if (!desktopLogPath) return;
  const safeMessage = redactLogSecrets(message).replace(/\r?\n/g, ' ');
  const line = `${new Date().toISOString()} [${String(level || 'INFO').toUpperCase()}] ${safeMessage}\n`;
  fs.appendFile(desktopLogPath, line, () => undefined);
}

function configureDesktopLog(userDataRoot) {
  try {
    const logDir = path.join(userDataRoot, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    desktopLogPath = path.join(logDir, 'workbench-desktop.log');
    appendDesktopLog('INFO', `Desktop shell starting; packaged=${app.isPackaged}; platform=${process.platform}; arch=${process.arch}`);
  } catch {
    desktopLogPath = null;
  }
}

process.on('uncaughtExceptionMonitor', (error, origin) => {
  appendDesktopLog('FATAL', `Main process uncaught exception (${origin || 'unknown'}): ${error?.stack || error}`);
});

function backendRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'backend') : path.resolve(__dirname, '..');
}

function prepareData() {
  const root = backendRoot();
  const userDataRoot = app.getPath('userData');
  configureDesktopLog(userDataRoot);
  const legacyCandidates = [
    path.join(root, 'data'),
    app.isPackaged ? path.join(process.resourcesPath, 'data') : null,
    !app.isPackaged ? path.resolve(__dirname, '..', 'data') : null
  ];
  const storage = prepareDesktopDataDir({ userDataRoot, legacyCandidates });
  appendDesktopLog('INFO', `Desktop data directory: ${storage.dataDir}`);
  return storage;
}

function probePort(requested = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => {
      const selected = server.address()?.port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

async function chooseBackendPort() {
  const requested = Number(process.env.MODBUS_DESKTOP_PORT || 0);
  if (Number.isInteger(requested) && requested >= 1024 && requested <= 65535) return probePort(requested);
  return probePort(0);
}

function backendEntry(root = backendRoot()) {
  return path.join(root, 'src', 'index-v8.js');
}

function startBackend(dataDir, selectedPort) {
  const root = backendRoot();
  const entry = backendEntry(root);
  const args = [
    entry,
    '--port', String(selectedPort),
    '--host', '127.0.0.1',
    '--data-dir', dataDir
  ];
  appendDesktopLog('INFO', `Starting v8 backend on 127.0.0.1:${selectedPort}`);
  backend = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  backend.stdout?.on('data', b => {
    const text = String(b).trim();
    console.log(text);
    if (text) appendDesktopLog('BACKEND', text);
  });
  backend.stderr?.on('data', b => {
    const text = String(b).trim();
    console.error(text);
    if (text) appendDesktopLog('BACKEND-ERROR', text);
  });
  backend.on('error', error => appendDesktopLog('ERROR', `Backend process error: ${error?.stack || error}`));
  backend.on('exit', (code, signal) => {
    appendDesktopLog(code ? 'ERROR' : 'INFO', `Backend exited code=${code ?? 'null'} signal=${signal || 'none'}`);
    backend = null;
    if (code && win && !win.isDestroyed() && !quitInProgress) dialog.showErrorBox('Workbench backend stopped', `Backend exited with code ${code}`);
  });
}

function waitReady(selectedPort, retries = 80) {
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`http://127.0.0.1:${selectedPort}/api/v8/status`, res => {
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
      appendDesktopLog('WARNING', `Backend PID ${child.pid} did not stop after SIGTERM; forcing termination.`);
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
    appendDesktopLog('ERROR', `Storage migration error: ${error?.stack || error}`);
    dialog.showErrorBox('Storage migration error', `${error.message}\n\nThe legacy data was left untouched. Resolve the storage issue before starting the Workbench.`);
    app.quit();
    return;
  }

  try { port = await chooseBackendPort(); }
  catch (error) {
    appendDesktopLog('ERROR', `Could not allocate local backend port: ${error?.stack || error}`);
    dialog.showErrorBox('Startup error', `Could not allocate the local backend port: ${error.message}`);
    app.quit();
    return;
  }

  startBackend(storage.dataDir, port);
  try { await waitReady(port); }
  catch (error) {
    appendDesktopLog('ERROR', `Backend startup failed: ${error?.stack || error}`);
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
  win.webContents.on('render-process-gone', (_event, details) => {
    appendDesktopLog('ERROR', `Renderer process gone reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'}`);
  });
  win.on('unresponsive', () => appendDesktopLog('WARNING', 'Desktop renderer became unresponsive.'));
  win.on('responsive', () => appendDesktopLog('INFO', 'Desktop renderer became responsive again.'));
  nativeTheme.on('updated', () => { if (win && !win.isDestroyed()) win.setBackgroundColor(backgroundColor()); });
  await win.loadURL(`http://127.0.0.1:${port}/v8/`);
  appendDesktopLog('INFO', `Workbench UI loaded on local backend port ${port}`);
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
  appendDesktopLog('INFO', 'Desktop shutdown requested; stopping backend.');
  terminateBackend().finally(() => {
    allowFinalQuit = true;
    app.quit();
  });
});

module.exports = { backendEntry, redactLogSecrets };
