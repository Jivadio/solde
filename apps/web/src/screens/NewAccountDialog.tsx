// SPDX-License-Identifier: AGPL-3.0-or-later
// Add a manual account, in a dialog opened from the overview or the
// accounts list. The member who adds it becomes its owner. The current
// balance is optional: it becomes the account's opening balance, and the
// transactions added afterwards move it.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { api, call, type AccountKind } from '../api/client';
import { errorMessage } from '../api/errors';
import { accountQuery, accountsQuery } from '../api/queries';
import { Button } from '../components/Button';
import { Dialog, DialogFooter } from '../components/Dialog';
import { Notice } from '../components/Display';
import { AmountField, SelectField, TextField } from '../components/Fields';
import { useToast } from '../components/Toast';
import {
  CURRENCIES,
  MINOR_DIGITS,
  currencySymbol,
  type OfferedCurrency,
} from '../lib/currencies';
import { useFormatLocale } from '../lib/locale';
import { parseAmount } from '../lib/money';
import { ACCOUNT_KINDS, amountError, useForm } from './common';

function useCurrencyOptions() {
  const locale = useFormatLocale();
  return useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'currency' });
    return CURRENCIES.map((code) => ({
      code,
      label: `${code} · ${names.of(code) ?? code}`,
    }));
  }, [locale]);
}

interface Values extends Record<string, string> {
  name: string;
  kind: string;
  currency: string;
  balance: string;
  iban: string;
}

function digitsOf(currency: string): number {
  return MINOR_DIGITS[currency as OfferedCurrency] ?? 2;
}

export function NewAccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const create = useMutation({
    mutationFn: (v: Values) => {
      const parsed = v.balance.trim()
        ? parseAmount(v.balance, { locale, digits: digitsOf(v.currency) })
        : null;
      return call(
        api.POST('/api/v1/accounts', {
          body: {
            name: v.name.trim(),
            kind: v.kind as AccountKind,
            currency: v.currency,
            iban: v.iban.trim() || null,
            balance_minor: parsed?.ok ? parsed.minor : null,
          },
        }),
      );
    },
    onSuccess: async (account) => {
      queryClient.setQueryData(accountQuery(account.id).queryKey, account);
      await queryClient.invalidateQueries({ queryKey: accountsQuery.queryKey });
      onClose();
      toast(t('newAccount.added'));
      await navigate({
        to: '/accounts/$accountId',
        params: { accountId: account.id },
      });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        create.reset();
        onClose();
      }}
      busy={create.isPending}
      title={t('newAccount.title')}
      description={t('newAccount.subtitle')}
    >
      <NewAccountForm
        pending={create.isPending}
        error={create.isError ? create.error : null}
        onCancel={onClose}
        onSubmit={(values) => create.mutate(values)}
      />
    </Dialog>
  );
}

function NewAccountForm({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: Values) => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const currencies = useCurrencyOptions();

  const form = useForm<Values>(
    { name: '', kind: 'checking', currency: 'EUR', balance: '', iban: '' },
    (v) => {
      const errors: Partial<Values> = {};
      if (!v.name.trim()) errors.name = t('newAccount.errors.nameRequired');
      if (v.balance.trim()) {
        const digits = digitsOf(v.currency);
        const parsed = parseAmount(v.balance, { locale, digits });
        if (!parsed.ok) errors.balance = amountError(t, parsed.error, digits);
      }
      return errors;
    },
  );

  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      {error != null && (
        <Notice tone="negative" title={t('newAccount.failed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      <TextField
        label={t('newAccount.name')}
        hint={t('newAccount.nameHint')}
        autoComplete="off"
        {...form.bind('name')}
      />
      <div className="sd-fields-2">
        <SelectField label={t('newAccount.kind')} {...form.bind('kind')}>
          {ACCOUNT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`accountKinds.${kind}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('newAccount.currency')}
          hint={t('newAccount.currencyHint')}
          {...form.bind('currency')}
        >
          {currencies.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>
      <AmountField
        label={t('newAccount.balance')}
        optionalLabel={t('forms.optional')}
        hint={t('newAccount.balanceHint')}
        currencyLabel={currencySymbol(locale, form.values.currency)}
        {...form.bind('balance')}
      />
      <TextField
        label={t('newAccount.iban')}
        optionalLabel={t('forms.optional')}
        hint={t('newAccount.ibanHint')}
        autoComplete="off"
        spellCheck={false}
        {...form.bind('iban')}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="plus" loading={pending}>
          {t('newAccount.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
