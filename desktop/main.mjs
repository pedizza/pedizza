import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const baseUrl = process.env.PEDIZZA_APP_URL || "https://www.pedizza.com.br";
const appOrigin = new URL(baseUrl).origin;
const startUrl = new URL("/app/pedidos", appOrigin).toString();
const iconPath = path.join(__dirname, "assets", "icon.png");

let mainWindow = null;
let tray = null;
let quitting = false;

app.setName("Pedizza Gestor de Pedidos");
app.setAppUserModelId("br.com.pedizza.gestor");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function isAllowedOrigin(value) {
  try {
    return new URL(value).origin === appOrigin;
  } catch {
    return false;
  }
}

function isPrintPage(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === appOrigin &&
      /^\/app\/pedidos\/[^/]+\/imprimir\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function openExternalSafely(value) {
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol))
      void shell.openExternal(url.toString());
  } catch {}
}

function keepInsideApp(event, value) {
  if (!isAllowedOrigin(value)) {
    event.preventDefault();
    openExternalSafely(value);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#f7f8f5",
    title: "Pedizza Gestor de Pedidos",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPrintPage(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 860,
          height: 900,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    openExternalSafely(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", keepInsideApp);
  mainWindow.webContents.on("will-redirect", keepInsideApp);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(startUrl);
}

function createTray() {
  const trayImage = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 20, height: 20 });
  tray = new Tray(trayImage);
  tray.setToolTip("Pedizza Gestor de Pedidos");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Abrir Gestor de Pedidos",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        callback(
          permission === "notifications" &&
            isAllowedOrigin(webContents.getURL()),
        );
      },
    );
    createWindow();
    createTray();
  });
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {});
