# AI Architectures for desktop

Electron shell around the two web apps: **CAD studio** (https://plans.ai-architectures.com) and **Quick render**
(https://ai-architectures.com). The sites are the app, so features ship with the sites; this repo only adds the
window, a mode menu (Ctrl/⌘+1, Ctrl/⌘+2), downloads to disk, sign-in and Stripe popups inside the app and other
links in the system browser. Download page: https://plans.ai-architectures.com/download

- Run: `npm install && npm start`
- Release: bump `version` in package.json, commit, `git tag v<version> && git push --tags` → GitHub Actions builds
  macOS (universal dmg/zip, ad-hoc signed), Windows (NSIS x64/arm64) and Linux (AppImage/deb x64/arm64) into the
  release. Stable download links: `https://github.com/20vision/ai-architectures-desktop/releases/latest/download/<file>`
- Not code-signed yet: Windows SmartScreen and macOS Gatekeeper show a warning on first start (see RELEASE_NOTES.md).
  Signing later: Apple Developer ID (+ notarization) and Azure Trusted Signing / a code-signing certificate.
