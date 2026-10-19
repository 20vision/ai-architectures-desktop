// AI Architectures for desktop: the two web apps in a window of their own.
//   CAD studio    https://plans.ai-architectures.com   (draw, change by chat, 3D, renders, DXF/DWG/PDF)
//   Quick render  https://ai-architectures.com          (photo or sketch in, photoreal render out)
// The apps update themselves (they are the live sites); this shell only adds the window, a menu to switch
// modes, downloads to disk and links to the system browser. First start asks which mode; the choice is kept.
const { app, BrowserWindow, Menu, shell, session, dialog, nativeTheme } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MODES = {
  cad: { url: 'https://plans.ai-architectures.com/', label: 'CAD studio' },
  render: { url: 'https://ai-architectures.com/', label: 'Quick render' },
};
// our sites and the sign-in / payment pages they open stay inside the app; everything else opens in the browser
const INSIDE = /(^|\.)ai-architectures\.com$/;
const POPUPS = /^(checkout\.stripe\.com|billing\.stripe\.com|js\.stripe\.com|hooks\.stripe\.com)$/;
// Google (and Apple) refuse to sign in inside an app's embedded browser ("This browser or app may not be secure"):
// sign-in runs in the system browser instead (browserSignIn)
const SIGNIN = /^(accounts\.google\.com|appleid\.apple\.com)$/;
const LOGIN_PAGE = 'https://plans.ai-architectures.com/desktop-login';
const STATE = () => path.join(app.getPath('userData'), 'state.json');

function readState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } }
function writeState(patch) { try { fs.writeFileSync(STATE(), JSON.stringify({ ...readState(), ...patch })); } catch { /* read-only profile */ } }

// A plain Chrome user agent: Google refuses sign-in in apps that name themselves Electron. The site still sees
// "AIArchitecturesDesktop" (analytics: which visits come from the app), except on Google's own pages.
const CHROME_UA = `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const APP_UA = `${CHROME_UA} AIArchitecturesDesktop/${app.getVersion()}`;

let win = null;

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

// the sites' own first-visit chooser reads this cookie (plan-chat lib/mode.js): the app already asked
function modeCookie(mode) {
  return session.defaultSession.cookies.set({ url: 'https://ai-architectures.com/', domain: '.ai-architectures.com', path: '/', name: 'pc_mode',
    value: mode, secure: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400 }).catch(() => {});
}

async function load(mode) {
  if (!MODES[mode]) return;
  writeState({ mode });
  buildMenu(mode);
  await modeCookie(mode);
  await win.loadURL(MODES[mode].url).catch(() => {});   // failures show offline.html (did-fail-load)
}

const modeOfUrl = (url) => { const h = hostOf(url); return /^(www\.)?ai-architectures\.com$/.test(h) ? 'render' : h === 'plans.ai-architectures.com' ? 'cad' : null; };

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
    if (SIGNIN.test(h)) { browserSignIn(); return { action: 'deny' }; }
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
    if (SIGNIN.test(h)) { e.preventDefault(); browserSignIn(); return; }
    if (url.startsWith('file:') || INSIDE.test(h) || POPUPS.test(h) || /stripe\.com$/.test(h)) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // the sites' own Render | CAD switch: keep the menu and the remembered mode in step
  wc.on('did-navigate', (_e, url) => {
    const m = modeOfUrl(url);
    if (m && m !== readState().mode) { writeState({ mode: m }); buildMenu(m); modeCookie(m); }
  });
  // offline / site unreachable: a small page with a retry button instead of a blank window
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = aborted (a redirect), not a failure
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url } });
  });

  const first = !st.mode;
  if (first || SMOKE) { win.loadFile(path.join(__dirname, 'start.html')); buildMenu(null); } else load(st.mode);
}

// --smoke-test (CI, on real Windows / macOS / Linux): both sites load in the app, the app is recognisable to
// analytics, and Google does not refuse its sign-in page as an embedded browser. Prints one SMOKE line, exits 0/1.
const SMOKE = process.argv.some((a) => a === '--smoke-test' || a.startsWith('--smoke-test='));
async function smokeTest() {
  const out = { platform: `${process.platform}-${process.arch}`, electron: process.versions.electron };
  // --smoke-test=<file>: also write the result there (Windows GUI apps have no console output in CI)
  const file = (process.argv.find((a) => a.startsWith('--smoke-test=')) || '').slice('--smoke-test='.length);
  const finish = (code) => {
    out.ok = code === 0;
    process.stdout.write(`SMOKE ${JSON.stringify(out)}\n`);
    if (file) try { fs.writeFileSync(file, JSON.stringify(out, null, 1)); } catch { /* reported by the missing file */ }
    app.exit(code);
  };
  setTimeout(() => { out.error = 'timeout'; finish(1); }, 150000);
  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    out.start = (await win.webContents.executeJavaScript('document.querySelector("h1")?.textContent || ""')).trim();
    for (const mode of ['cad', 'render']) {
      await load(mode);
      await settle(4000);
      const js = 'JSON.stringify({ title: document.title, text: document.body.innerText.length, app: navigator.userAgent.includes("AIArchitecturesDesktop"), electron: navigator.userAgent.includes("Electron"), chooser: !!document.querySelector("[aria-labelledby=mode-title]") })';
      out[mode] = { url: win.webContents.getURL(), ...JSON.parse(await win.webContents.executeJavaScript(js)) };
    }
    // Google sign-in goes to the system browser: a popup to Google from the page starts the hand-off …
    const opened = [];
    shell.openExternal = async (u) => { opened.push(u); };
    await win.webContents.executeJavaScript("window.open('https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'g'); 1");
    await settle(1500);
    const p = pendingSignIn;
    out.signin = { browser: opened[0]?.split('?')[0] || null, popups: BrowserWindow.getAllWindows().length - 1 };
    // … the listener refuses a wrong state, takes the right one and signs the app in (aa_session cookie)
    const hit = (st, tok) => new Promise((r) => http.get(`http://127.0.0.1:${p?.port}/callback?state=${st}&token=${tok}`, (res) => { res.resume(); r(res.statusCode); }).on('error', () => r(0)));
    const fake = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ id: 0, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url'), 'c2lnbmF0dXJl'].join('.');
    out.signin.wrongState = await hit('0'.repeat(32), fake);
    out.signin.rightState = await hit(p?.state, fake);
    await settle(1500);
    const ck = await session.defaultSession.cookies.get({ name: 'aa_session' });
    out.signin.cookie = ck.length === 1 && decodeURIComponent(ck[0].value) === fake;
    await session.defaultSession.cookies.remove('https://ai-architectures.com/', 'aa_session');
    const ok = out.start && ['cad', 'render'].every((m) => out[m].text > 50 && out[m].app && !out[m].electron && !out[m].chooser) && out.signin.browser === LOGIN_PAGE && out.signin.popups === 0 && out.signin.wrongState === 404 && out.signin.rightState === 200 && out.signin.cookie;
    finish(ok ? 0 : 1);
  } catch (e) { out.error = String(e?.message || e); finish(1); }
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

// Sign-in in the system browser: a one-time listener on 127.0.0.1, the website's /desktop-login page (signed in
// there, the visitor presses "Continue in the app") calls it back with the login and the random state. The login
// becomes the aa_session cookie that both sites already share (plan-chat lib/aaSso.js), then the page reloads.
let pendingSignIn = null;
const SIGNED_IN_PAGE = '<!doctype html><meta charset="utf-8"><title>Signed in</title><body style="font:16px -apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:90vh;color:#111"><div style="text-align:center"><h1 style="font-size:22px">You are signed in</h1><p>Go back to the AI Architectures app. You can close this tab.</p></div>';

function browserSignIn() {
  if (pendingSignIn) { shell.openExternal(pendingSignIn.url); return pendingSignIn; }
  const state = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback' || u.searchParams.get('state') !== state) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SIGNED_IN_PAGE);
    const token = u.searchParams.get('token') || '';
    endSignIn();
    signInWith(token);
  });
  const timer = setTimeout(endSignIn, 15 * 60 * 1000);
  pendingSignIn = { server, timer, state, url: null };
  server.listen(0, '127.0.0.1', () => {
    if (!pendingSignIn) return;
    pendingSignIn.port = server.address().port;
    pendingSignIn.url = `${LOGIN_PAGE}?port=${pendingSignIn.port}&state=${state}`;
    shell.openExternal(pendingSignIn.url);
  });
  return pendingSignIn;
}

function endSignIn() {
  if (!pendingSignIn) return;
  clearTimeout(pendingSignIn.timer);
  pendingSignIn.server.close();
  pendingSignIn = null;
}

async function signInWith(token) {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return false;
  let exp = 0;
  try { exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp || 0; } catch { /* not a JWT body */ }
  await session.defaultSession.cookies.set({ url: 'https://ai-architectures.com/', domain: '.ai-architectures.com', path: '/', name: 'aa_session',
    value: encodeURIComponent(token), secure: true, sameSite: 'lax', expirationDate: exp || Math.floor(Date.now() / 1000) + 30 * 86400 });
  for (const w of BrowserWindow.getAllWindows()) if (w !== win) w.close();
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (win.webContents.getURL().startsWith('https:')) win.webContents.reload(); }
  return true;
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
    if (SMOKE) smokeTest();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
