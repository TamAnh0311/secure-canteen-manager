import { app, dialog } from 'electron';
import { ensureConfig } from './first-launch';
import { startBackend, stopBackend } from './backend-process';
import { createMainWindow } from './window';
import { createTray } from './tray';

/** Prevent multiple instances — a second launch focuses the existing window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

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
    // 1. Ensure config exists (first-launch setup)
    const config = await ensureConfig();

    // 2. Start the NestJS backend
    const port = await startBackend(config);
    const backendUrl = `http://localhost:${port}`;
    console.log(`Backend ready at ${backendUrl}`);

    // 3. Create system tray
    createTray(backendUrl);

    // 4. Open main window
    createMainWindow(backendUrl);
  } catch (err) {
    console.error('Failed to start application:', err);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Canteen Manager — Startup Error',
      message: `Failed to start the application.\n\n${err instanceof Error ? err.message : String(err)}`,
      buttons: ['Quit'],
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit when all windows close
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  console.log('Shutting down backend...');
  await stopBackend();
  console.log('Backend stopped. Exiting.');
  app.exit(0);
});
