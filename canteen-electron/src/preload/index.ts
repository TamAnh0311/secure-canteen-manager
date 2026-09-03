/**
 * Minimal preload script. Context isolation is enabled — no Node APIs exposed.
 * Extend this with contextBridge.exposeInMainWorld() if Electron-specific
 * features (e.g., native file dialogs) are needed in the renderer later.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
