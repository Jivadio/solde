// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from 'vitest';
import money from '../../../../crates/core-domain/src/money.rs?raw';
import { CURRENCIES, MINOR_DIGITS, currencySymbol } from './currencies';

it('uses the server’s ISO 4217 digits for every offered currency', () => {
  for (const code of CURRENCIES) {
    const entry = new RegExp(`\\("${code}", (\\d+)\\)`).exec(money);
    expect(entry, code).not.toBeNull();
    expect(MINOR_DIGITS[code], code).toBe(Number(entry?.[1]));
  }
});

it('finds the currency symbol for the locale', () => {
  expect(currencySymbol('en', 'EUR')).toBe('€');
  expect(currencySymbol('en', 'not a code')).toBe('not a code');
});
