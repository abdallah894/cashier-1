import type { StoreInfo } from "./types";

/**
 * Store identity printed on receipts. The real values live in the
 * `store_settings` table (Reports → Store settings); this neutral default is
 * only what a till shows before the owner has filled them in. Empty fields are
 * left off the receipt rather than printing made-up data.
 */
export const DEFAULT_STORE_INFO: StoreInfo = {
  nameAr: "سوبر ماركت",
  nameEn: "Supermarket",
  addressAr: "",
  addressEn: "",
  phone: "",
  taxId: "",
  footerAr: "",
  footerEn: "",
};

type StoreSettingsRow = {
  store_name_ar: string;
  store_name_en: string;
  address_ar: string;
  address_en: string;
  phone: string;
  tax_registration_number: string;
  receipt_footer_ar: string;
  receipt_footer_en: string;
};

/** Maps the settings row to the receipt shape, falling back to the default name when none is set. */
export function storeInfoFromSettings(row: StoreSettingsRow): StoreInfo {
  const nameAr = row.store_name_ar.trim();
  const nameEn = row.store_name_en.trim();
  return {
    // one language filled in is enough: reuse it for the other rather than print the default
    nameAr: nameAr || nameEn || DEFAULT_STORE_INFO.nameAr,
    nameEn: nameEn || nameAr || DEFAULT_STORE_INFO.nameEn,
    addressAr: row.address_ar.trim() || row.address_en.trim(),
    addressEn: row.address_en.trim() || row.address_ar.trim(),
    phone: row.phone.trim(),
    taxId: row.tax_registration_number.trim(),
    footerAr: row.receipt_footer_ar.trim() || row.receipt_footer_en.trim(),
    footerEn: row.receipt_footer_en.trim() || row.receipt_footer_ar.trim(),
  };
}
