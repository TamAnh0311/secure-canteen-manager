import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { getMainWindow, createMainWindow } from './window';

let tray: Tray | null = null;

/**
 * Create a system tray icon with a context menu.
 */
export function createTray(backendUrl: string): Tray {
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources'),
    'icon.ico',
  );

  // Fallback to empty icon if file doesn't exist (dev mode without icon)
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Canteen Manager — Running');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Canteen Manager',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        } else {
          createMainWindow(backendUrl);
        }
      },
    },
    { type: 'separator' },
    {
      label: `Server: ${backendUrl}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    const win = getMainWindow();
    if (win) {
      win.show();
      win.focus();
    } else {
      createMainWindow(backendUrl);
    }
  });

  return tray;
}
