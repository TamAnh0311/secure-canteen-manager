import { app, dialog, shell } from 'electron';
import { ensureConfig } from './first-launch';
import { startBackend, stopBackend, forceKillBackend, crashLogPath, writeCrashLog } from './backend-process';
import { createMainWindow } from './window';
import { createTray } from './tray';

const startTime = Date.now();

/** Log a timestamped startup step with elapsed time from app start. */
function logStep(step: string): void {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[ELECTRON +${elapsed}s] ${step}`);
}

/** Prevent multiple instances — a second launch focuses the existing window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/**
 * Safety net: if the Electron process exits abnormally (crash, SIGKILL, etc.),
 * synchronously kill the forked backend so it doesn't linger as an orphan.
 */
process.on('exit', () => {
  forceKillBackend();
});

app.on('second-instance', () => {
  const { getMainWindow } = require('./window');
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('ready', async () => {
  try {
    logStep('app.ready fired');

    // 1. Ensure config exists (first-launch setup)
    logStep('Step 1/4: ensureConfig()...');
    const config = await ensureConfig();
    logStep('Step 1/4: ensureConfig() done');

    // 2. Start the NestJS backend
    logStep('Step 2/4: startBackend()...');
    const port = await startBackend(config);
    const backendUrl = `http://localhost:${port}`;
    logStep(`Step 2/4: startBackend() done — ${backendUrl}`);

    // 3. Create system tray
    logStep('Step 3/4: createTray()...');
    createTray(backendUrl);
    logStep('Step 3/4: createTray() done');

    // 4. Open main window
    logStep('Step 4/4: createMainWindow()...');
    createMainWindow(backendUrl);
    logStep('Step 4/4: createMainWindow() done — startup complete');
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    console.error('Failed to start application:', err);
    writeCrashLog('STARTUP_FAILURE', errorText);
    const logFile = crashLogPath();
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Canteen Manager — Startup Error',
      message: `Failed to start the application.\n\n${errorText}`,
      detail: `Crash log: ${logFile}`,
      buttons: ['Open Log Folder', 'Quit'],
      defaultId: 1,
    });
    if (response === 0) {
      shell.showItemInFolder(logFile);
    }
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit when all windows close.
  // Users exit via tray → Quit, or the window's File/Exit menu.
});

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  (app as unknown as { isQuitting: boolean }).isQuitting = true;
  event.preventDefault();
  console.log('Shutting down backend...');
  await stopBackend();
  console.log('Backend stopped. Exiting.');
  app.exit(0);
});
