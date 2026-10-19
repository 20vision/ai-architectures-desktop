// AI Architectures for desktop: the two web apps in a window of their own.
//   CAD studio    https://plans.ai-architectures.com   (draw, change by chat, 3D, renders, DXF/DWG/PDF)
//   Quick render  https://ai-architectures.com          (photo or sketch in, photoreal render out)
// The apps update themselves (they are the live sites); this shell only adds the window, a menu to switch
// modes, downloads to disk and links to the system browser. First start asks which mode; the choice is kept.
const { app, BrowserWindow, Menu, shell, session, dialog, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MODES = {
  cad: { url: 'https://plans.ai-architectures.com/', label: 'CAD studio' },
  render: { url: 'https://ai-architectures.com/', label: 'Quick render' },
};
// our sites and the sign-in / payment pages they open stay inside the app; everything else opens in the browser
const INSIDE = /(^|\.)ai-architectures\.com$/;
const POPUPS = /^(accounts\.google\.com|appleid\.apple\.com|checkout\.stripe\.com|billing\.stripe\.com|js\.stripe\.com|hooks\.stripe\.com)$/;
const STATE = () => path.join(app.getPath('userData'), 'state.json');

function readState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } }
function writeState(patch) { try { fs.writeFileSync(STATE(), JSON.stringify({ ...readState(), ...patch })); } catch { /* read-only profile */ } }

// A plain Chrome user agent: Google refuses sign-in in apps that name themselves Electron. The site still sees
// "AIArchitecturesDesktop" (analytics: which visits come from the app), except on Google's own pages.
const CHROME_UA = `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const APP_UA = `${CHROME_UA} AIArchitecturesDesktop/${app.getVersion()}`;

let win = null;

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

function load(mode) {
  if (!MODES[mode]) return;
  writeState({ mode });
  win.loadURL(MODES[mode].url);
  buildMenu(mode);
}

function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: st.bounds?.width || 1440, height: st.bounds?.height || 900, x: st.bounds?.x, y: st.bounds?.y,
    minWidth: 900, minHeight: 600, title: 'AI Architectures', backgroundColor: '#0f141b', show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const save = () => { if (!win.isMinimized()) writeState({ bounds: win.isMaximized() ? st.bounds : win.getBounds(), maximized: win.isMaximized() }); };
  win.on('resize', save); win.on('move', save);

  const wc = win.webContents;
  wc.setUserAgent(APP_UA);
  wc.setWindowOpenHandler(({ url }) => {
    const h = hostOf(url);
    if (INSIDE.test(h) || POPUPS.test(h)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, parent: win, autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } } };
    }
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => child.webContents.setUserAgent(CHROME_UA));
  // a link to another site in the main window: the system browser (checkout and sign-in may redirect in place)
  wc.on('will-navigate', (e, url) => {
    const pick = /^aiarch:\/\/mode\/(cad|render)$/.exec(url);   // the start page's two choices
    if (pick) { e.preventDefault(); load(pick[1]); return; }
    const h = hostOf(url);
    if (url.startsWith('file:') || INSIDE.test(h) || POPUPS.test(h) || /stripe\.com$/.test(h)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // offline / site unreachable: a small page with a retry button instead of a blank window
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = aborted (a redirect), not a failure
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url } });
  });

  const first = !st.mode;
  if (first) { win.loadFile(path.join(__dirname, 'start.html')); buildMenu(null); } else load(st.mode);
}

function buildMenu(mode) {
  const isMac = process.platform === 'darwin';
  const modeItems = Object.entries(MODES).map(([k, m], i) => ({
    label: m.label, type: 'radio', checked: k === mode, accelerator: `CmdOrCtrl+${i + 1}`, click: () => load(k),
  }));
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      ...modeItems,
      { type: 'separator' },
      { label: 'Open in browser', accelerator: 'CmdOrCtrl+Shift+O', click: () => { const u = win?.webContents.getURL(); if (u?.startsWith('http')) shell.openExternal(u); } },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
      { role: 'reload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Help & support', click: () => shell.openExternal('https://plans.ai-architectures.com/support') },
      { label: 'Pricing', click: () => shell.openExternal('https://plans.ai-architectures.com/pricing') },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// downloads (DXF, DWG, PDF, renders): ask where to save, starting in Downloads
function wireDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    item.once('done', (_ev, state) => {
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(item.getSavePath());
      if (state === 'interrupted') dialog.showErrorBox('Download failed', `${item.getFilename()} could not be saved. Please try again.`);
    });
  });
  // no camera / microphone / location for the sites; notifications and clipboard writes are fine
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';
    wireDownloads();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
