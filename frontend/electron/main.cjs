const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

// ─── Configuración ──────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'VCDetection — Panel de Control',
    icon: path.join(__dirname, '..', 'public', 'favicon.svg'),
    backgroundColor: '#080d14',
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // En desarrollo, cargar desde el servidor de Vite
  // En producción, cargar el archivo index.html compilado
  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    // Abrir DevTools en desarrollo (descomenta si lo necesitas)
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Evento de cierre: minimizar a bandeja en vez de cerrar
  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Menú de la bandeja del sistema ─────────────────────────────────────────
function createTray() {
  // Crear un icono básico para la bandeja
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('VCDetection — Monitoreo Activo');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🔍 Abrir VCDetection',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '❌ Salir completamente',
      click: () => {
        tray.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Lifecycle de Electron ──────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
