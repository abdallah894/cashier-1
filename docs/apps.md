# Desktop and mobile apps

Cachier POS ships as **one web app** (Next.js on Vercel) wrapped by thin native shells. The shells load the deployed site, so server actions, Supabase auth, RLS and releases work unchanged and a web deploy updates every device at once. You only rebuild a shell when the shell itself changes.

| Shell | Folder | Tech | Output |
|---|---|---|---|
| Windows / macOS / Linux | `desktop/` | Electron | `.exe` installer, `.dmg`, `.AppImage` / `.deb` |
| Android | `mobile/android/` | Capacitor | `.apk` / `.aab` |
| iOS | `mobile/ios/` | Capacitor | built in Xcode (needs a Mac) |

Both shells are excluded from the root lint, typecheck and tests. They have their own `package.json`.

## Before any build
Deploy the web app first and note its https URL, then set it in:
- `desktop/app-config.json` → `appUrl` (a build refuses to run while it is still the placeholder)
- `mobile/capacitor.config.json` → `server.url`

## Desktop (Electron, Windows first)

**Full setup, printer steps, release process and the acceptance checklist: [desktop-printing.md](desktop-printing.md).**

```bash
cd desktop
npm install
npm start                # dev window against appUrl (POS_APP_URL overrides it)
npm run smoke            # launches the real app headlessly and checks the bridge (xvfb-run -a on Linux)
npm run dist:win         # installer in desktop/dist (run on Windows)
npm run release:win      # build AND publish to the releases repo (CI does this on a desktop-v* tag)
```

What the shell adds over a browser tab:
- Locked-down window: sandbox, context isolation, no Node in the page, only the app origin is allowed (other links open in the browser).
- **Printing through the Windows print queue** (raw ESC/POS, so the printer keeps its normal driver; no Zadig). The cash drawer is kicked through the same printer. Bridge: `desktop/print-bridge.cjs`, exposed to the page as `window.cachierShell.printers` (`desktop/preload.cjs`); web side `lib/devices/shell.ts`.
- **Auto-update** from a public releases repository (`desktop/updater.cjs`): background download, installs on close or when the cashier presses "Restart to update"; never in the middle of a sale. Per-user install, so updates need no administrator prompt.
- **Kiosk mode** (`"kiosk": true`), **start with Windows** (`"autoStart": true`) in `app-config.json`. Exit kiosk with Alt+F4.
- Automatic reload if the page crashes or freezes (max 3 times a minute, then an offline notice).
- Camera permission for the app origin only; the legacy WebUSB chooser still works for USB printers set up the old way.
- Offline page if the site cannot be reached on a cold start; after the first load the service worker and the offline sale queue keep working.
- Single instance, F11 fullscreen, zoom.

Signing: **the installer is not signed** (decision for a small number of PCs you control: click *More info → Run anyway* once per PC). The build already signs automatically when `CSC_LINK` / `CSC_KEY_PASSWORD` (a certificate) are provided as secrets, so signing can be added later without code changes. Since 2023 trusted code-signing certificates are issued on hardware tokens or cloud signing services, which makes signing in CI more involved and costs roughly $200-400 a year; check whether the cloud services you consider are available in Egypt before buying. Replace the placeholder icon by putting `icon.png` (512 px or more; or `icon.ico`) in `desktop/build/`.

## Mobile (Capacitor)

```bash
cd mobile
npm install
npm run android          # syncs and opens Android Studio -> Run, or Build > Generate Signed Bundle
npm run ios              # on a Mac: syncs and opens Xcode -> Run / Archive
```

- Camera barcode scanning uses the web camera in the WebView. The `CAMERA` permission (Android) and `NSCameraUsageDescription` (iOS) are already declared.
- The register works on a phone or tablet (it stacks into one column) and all manager screens are responsive; the layout respects notches (`viewport-fit=cover` plus safe-area padding).
- **WebUSB printing does not work on iOS or in the Android WebView.** On phones, print through the system print dialog (PDF / AirPrint / Android print service) or use the desktop app at the counter. The USB drawer kick is likewise a counter-PC feature.
- App icons and splash: generate with `npx @capacitor/assets generate` after adding `mobile/assets/icon.png` and `splash.png`.
- Play Store: create a signing key, build a signed `.aab`, complete the Data safety form. App Store: an Apple Developer account ($99/year). **Apple often rejects apps that are only a website in a wrapper** (guideline 4.2); if you publish to the App Store, expect to add native value (for example the ML Kit camera scanner plugin, push notifications for low-stock and alerts) or distribute to staff privately through TestFlight / Apple Business Manager. Android internal testing or direct APK installs avoid this.

## Installable PWA (works everywhere, no store)
The same site is installable from Chrome / Edge (Windows, macOS, Linux, Android) and Safari (Add to Home Screen on iOS). It is the fallback when a store or installer is not wanted.

## Build in CI
`.github/workflows/apps.yml` builds the desktop installers (Windows, macOS, Linux) and an Android debug APK on demand (Actions → Build apps → Run workflow, entering the production URL), and **publishes the Windows installer when you push a `desktop-v<version>` tag** (see [desktop-printing.md](desktop-printing.md)). Artifacts are unsigned. `ci.yml` also launches the real desktop app headlessly on every change (`desktop-smoke`).

## Release checklist for the shells
- [ ] URL set in both configs; same domain as the production site.
- [ ] Desktop: counter PC installed, kiosk mode on, printer chosen once, camera and scanner tested.
- [ ] Android: sign in, scan with the camera, make a sale, go offline and back.
- [ ] iOS: same, on a real device via TestFlight.
- [ ] Signing certificates / keys stored in a password manager, not in the repo.
