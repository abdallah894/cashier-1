-- Phase 3: receipt printing through the Windows print queue (desktop app).
-- WebUSB needs the printer's driver replaced (Zadig); the desktop app can print raw
-- ESC/POS through the normal driver instead. The device row stores the queue name in
-- settings.printerName. The cash-drawer kick uses the same printer.
insert into public.device_profiles (key, kind, label, supported, notes) values
  ('escpos_spooler_80mm', 'printer', 'ESC/POS thermal printer through the Windows print queue (desktop app, 80 mm)', true,
   'Desktop app only. Install the printer''s normal Windows driver, then choose the printer on the Devices page.');
