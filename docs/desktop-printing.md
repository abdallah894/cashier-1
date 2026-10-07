# Windows desktop app: printing, updates, setup

The Cachier desktop app is the website inside a Windows program. It adds what a browser cannot do: **print to the printer's normal Windows driver** (no driver swap), start with the PC, and **update itself**. The website still does everything else, so a website update reaches the till at once.

## 1. One-time setup by you (the owner / developer)

Do these in order. (Step 4 is already done in the code.)

1. **Create the public releases repository** (GitHub would not let the Claude app create it): https://github.com/new → owner `abdallah894`, name **`cachier-pos-releases`**, **Public**, tick _Add a README_. It will only ever contain installers and update files, no code and no secrets.
2. **Create an access token** for it: https://github.com/settings/personal-access-tokens/new → _Fine-grained token_ → name `cachier-releases` → expiry as you prefer (set a reminder to renew it) → **Repository access: Only select repositories → `cachier-pos-releases`** → Permissions → Repository permissions → **Contents: Read and write** → Generate, and copy the token (it is shown once).
3. In the **code repository** `cashier-1`:
   - secret `RELEASES_REPO_TOKEN` = the token from step 2: https://github.com/abdallah894/cashier-1/settings/secrets/actions
   - variable `POS_APP_URL` = your **production website address**, for example `https://pos.yourshop.com` (the website must be deployed first, see `docs/operations/go-live-checklist.md`): https://github.com/abdallah894/cashier-1/settings/variables/actions
4. ✅ Done: `desktop/package.json` → `build.publish` already points at `abdallah894/cachier-pos-releases`.
5. **Publish the first version** (only after steps 1-3): create and push a tag that matches the version in `desktop/package.json`:
   ```
   git tag desktop-v1.0.0
   git push origin desktop-v1.0.0
   ```
   The _Build apps_ workflow builds the installer and publishes it to the releases repository (`Cachier-POS-Setup-1.0.0.exe`). If it fails, open the run in the Actions tab; the first lines say which setting is missing.
   A tag runs the workflow **as it was at that commit**. After a fix to the workflow is merged, move the tag to the new commit instead of making a new version:
   ```
   git checkout main && git pull
   git tag -d desktop-v1.0.0 && git push origin :refs/tags/desktop-v1.0.0
   git tag desktop-v1.0.0 && git push origin desktop-v1.0.0
   ```

To release a new version later: raise `version` in `desktop/package.json`, commit, tag `desktop-v<that version>`, push the tag. Every till updates itself.

## 2. Install on the counter PC

1. Download `Cachier-POS-Setup-<version>.exe` from the releases repository and run it. It installs for the current Windows user (no administrator password, and updates install silently).
2. Windows shows a blue _"Windows protected your PC"_ screen because the installer is **not signed** (a certificate costs money and is not needed for a few PCs you control). Click **More info → Run anyway**, once per PC.
3. To make the till open full-screen and start with Windows, edit `autoStart` / `kiosk` in `desktop/app-config.json` **before building** (`"kiosk": true`, `"autoStart": true`). Exit kiosk mode with Alt+F4.

## 3. Connect the receipt printer (normal driver, no Zadig)

1. Plug the printer in and install the **manufacturer's Windows driver** as for any printer. Check it appears in _Settings → Bluetooth & devices → Printers & scanners_, and print a Windows test page.
2. Open Cachier **inside the desktop app** → **Devices** → _Add device_ → kind **Printer** → profile **ESC/POS thermal printer through the Windows print queue** → Save.
3. In that row, **choose the printer** from the list and press **Test print**. A short page with "Printer test OK" must come out and the paper must cut.
4. Press **Check** (it records whether Windows still lists the printer).
5. **Cash drawer:** add a device of kind _Cash drawer_, profile _wired to the receipt printer_. **Open drawer** on the Devices page, and every cash sale, now kick the drawer through this printer.
6. Make a test sale and print the receipt in **Arabic** and in **English** (Arabic prints as a picture so letters are joined correctly).

> The printer must be set up in the **desktop app**. In an ordinary browser the Devices page tells you so, and printing falls back to the browser's print dialog.

## 4. What the app does to protect the till

- The page can only talk to the printer bridge from the app's own address, and only to printers Windows lists. Data is limited to 2 MB per print.
- If the page crashes or freezes, the app reloads it (at most 3 times a minute, then shows an offline notice).
- Updates download in the background and **never restart the app by themselves**. They install the next time the app is closed, or when the cashier presses **Restart to update** (the button is disabled while a sale is in the cart). If the website ever needs a newer app than the one installed, a red notice says so.

## 5. Troubleshooting

| Message / symptom                                | What to do                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| "That printer is not installed on this computer" | The name saved on the Devices page no longer exists in Windows (renamed, removed). Choose the printer again.                          |
| "Windows did not accept the receipt"             | Printer off, out of paper, cover open, **paused or set to "Use printer offline"** in the Windows print queue. Fix it and print again. |
| "The printer took too long"                      | Check the USB cable and power; restart the printer.                                                                                   |
| Nothing prints and no error                      | Make sure you are using the desktop app, and the device on Devices uses the _Windows print queue_ profile.                            |
| Garbage text prints                              | The printer is not an ESC/POS printer. Choose a model that supports ESC/POS (most 80 mm thermal printers do).                         |
| Receipt prints but the drawer does not open      | The drawer cable must be in the printer's RJ11 "DK" port; some printers need the drawer option enabled in their own settings.         |
| Red banner "this till app is too old"            | Install the newest `Cachier-POS-Setup-<version>.exe` from the releases repository.                                                    |

## 6. Counter-PC acceptance checklist (do this once, with the real printer)

- [ ] Installed; opens; signs in; the register works.
- [ ] Test print and the cut work; Arabic and English receipts are correct.
- [ ] Drawer opens on a cash sale and on **Open drawer**; both appear in the audit log.
- [ ] Unplug the printer and sell: a clear message appears (not a crash) and the sale is still recorded.
- [ ] Switch the printer off and print: message mentions the printer; reprint works after switching on.
- [ ] Disconnect the network and make a sale: it queues and prints its provisional receipt; reconnect: it syncs.
- [ ] Update test: install 1.0.0, publish 1.0.1, wait or restart: the _Restart to update_ banner appears (or it installs on next start).
- [ ] Windows restart: the app starts by itself (if `autoStart` is on).

## 7. What has and has not been verified

Verified in automated tests: the bridge's rules (which printers, how much data, who may call it), how the Windows and Linux print commands are built (including hostile printer names), failure messages, the update policy, crash-reload limiting, and — by launching the **real** desktop app headlessly — that the page gets the bridge and nothing else, in both a source run and a packaged run.

**Not verified (needs a Windows PC and a real printer):** the actual call into the Windows print spooler, the NSIS installer, and an update downloaded from GitHub. Use the checklist above.
