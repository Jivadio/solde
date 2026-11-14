// SPDX-License-Identifier: AGPL-3.0-or-later
// Currencies offered when adding an account, with their ISO 4217
// minor-unit digits. Accounts that exist carry `minor_digits` from the
// server; these digits are only for parsing a balance typed before the
// account exists, and a test checks them against the server's table.

/** Offered first; the names come from `Intl`, per locale. */
export const CURRENCIES = [
  'EUR',
  'CHF',
  'GBP',
  'USD',
  'CAD',
  'DKK',
  'SEK',
  'NOK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'JPY',
] as const;

export type OfferedCurrency = (typeof CURRENCIES)[number];

/** ISO 4217 minor-unit digits (not CLDR's: HUF and CZK have 2 here). */
export const MINOR_DIGITS: Record<OfferedCurrency, number> = {
  EUR: 2,
  CHF: 2,
  GBP: 2,
  USD: 2,
  CAD: 2,
  DKK: 2,
  SEK: 2,
  NOK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  RON: 2,
  JPY: 0,
};

/** The currency's symbol in the locale (`€`, `CHF`, `£`). */
export function currencySymbol(locale: string, currency: string): string {
  try {
    return (
      new Intl.NumberFormat(locale, { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}
