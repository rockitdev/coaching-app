const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

// Database initialization
const { initDatabase } = require('../database/db');

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Create the browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, '../renderer/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Open DevTools during development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Create window when Electron has finished initialization
app.on('ready', () => {
  createWindow();
  
  // Initialize database
  initDatabase()
    .then(() => console.log('Database initialized successfully'))
    .catch(err => console.error('Failed to initialize database:', err));
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS applications keep their menu bar active until user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS re-create a window when dock icon is clicked and no other windows open
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC handlers for file dialogs
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});