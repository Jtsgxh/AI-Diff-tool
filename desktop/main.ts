import { app, BrowserWindow, dialog, shell } from 'electron';
import type { Server } from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { startServer } from '../server/runtime';

dotenv.config();

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4000;
const APP_URL = `http://${HOST}:${PORT}`;

let mainWindow: BrowserWindow | null = null;
let httpServer: Server | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f5f2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== APP_URL && !url.startsWith(`${APP_URL}/`)) event.preventDefault();
  });

  void mainWindow.loadURL(APP_URL);
}

function stopServer(): void {
  if (!httpServer) return;
  httpServer.close();
  httpServer.closeAllConnections();
  httpServer = null;
}

async function startDesktop(): Promise<void> {
  try {
    httpServer = await startServer({
      host: HOST,
      port: PORT,
      staticDir: path.join(app.getAppPath(), 'dist'),
    });
    httpServer.on('error', (err) => {
      dialog.showErrorBox('AI Diff Tool', `本地服务发生错误：${err.message}`);
      app.quit();
    });
    createWindow();
  } catch (err) {
    const message =
      (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `端口 ${PORT} 已被占用。请关闭占用该端口的程序后重新启动。`
        : `本地服务启动失败：${err instanceof Error ? err.message : String(err)}`;
    dialog.showErrorBox('AI Diff Tool 无法启动', message);
    app.quit();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktop);
  app.on('before-quit', stopServer);
  app.on('window-all-closed', () => app.quit());
}
