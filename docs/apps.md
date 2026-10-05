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

## Desktop (Electron)

```bash
cd desktop
npm install
npm start                # dev window against appUrl (POS_APP_URL overrides it)
npm run dist:win         # installer in desktop/dist (run on Windows)
npm run dist:mac         # run on a Mac
npm run dist:linux       # run on Linux
```

What the shell adds over a browser tab:
- Locked-down window: sandbox, context isolation, no Node in the page, only the app origin is allowed (other links open in the browser).
- **Kiosk mode** for the counter PC: set `"kiosk": true` in `app-config.json` or start with `--kiosk`. Exit with Alt+F4.
- **WebUSB receipt printer chooser** (Electron has no built-in picker). One device is chosen automatically; several show a list.
- Camera permission for the app origin only.
- Offline page if the site cannot be reached on a cold start. After the first successful load, the service worker serves the cached shell and the offline sale queue keeps working.
- Single instance, F11 fullscreen, zoom.

Signing: unsigned installers trigger Windows SmartScreen / macOS Gatekeeper warnings. For production add a code-signing certificate (Windows) and an Apple Developer ID + notarization (macOS) through the `electron-builder` env variables `CSC_LINK`, `CSC_KEY_PASSWORD` (and `APPLE_*` for notarization). Replace the default icon by putting `icon.ico` / `icon.icns` / `icon.png` in `desktop/build/`.

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
`.github/workflows/apps.yml` builds the desktop installers (Windows, macOS, Linux) and an Android debug APK on demand (Actions → Build apps → Run workflow, entering the production URL). Artifacts are unsigned.

## Release checklist for the shells
- [ ] URL set in both configs; same domain as the production site.
- [ ] Desktop: counter PC installed, kiosk mode on, printer chosen once, camera and scanner tested.
- [ ] Android: sign in, scan with the camera, make a sale, go offline and back.
- [ ] iOS: same, on a real device via TestFlight.
- [ ] Signing certificates / keys stored in a password manager, not in the repo.
