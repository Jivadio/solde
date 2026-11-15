// SPDX-License-Identifier: AGPL-3.0-or-later
// Edit an account's name and opening balance (owners only), in a dialog
// opened from the account screen. The same dialog, reduced to the balance,
// sets the balance of an account added without one. The type, currency
// and IBAN never change. Only the fields that changed are sent.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, call, type Account } from '../api/client';
import { errorMessage } from '../api/errors';
import { accountQuery, accountsQuery } from '../api/queries';
import { Button } from '../components/Button';
import { Dialog, DialogFooter } from '../components/Dialog';
import { Notice } from '../components/Display';
import { AmountField, TextField } from '../components/Fields';
import { useToast } from '../components/Toast';
import { currencySymbol } from '../lib/currencies';
import { useFormatLocale } from '../lib/locale';
import { minorToDecimalString, parseAmount, separators } from '../lib/money';
import { amountError, useForm } from './common';

interface Values extends Record<string, string> {
  name: string;
  balance: string;
}

interface Changes {
  name?: string;
  balance_minor?: number | null;
}

/** A stored balance as the person would type it in their locale. */
export function editableAmount(
  minor: number | null,
  digits: number,
  locale: string,
): string {
  if (minor == null) return '';
  return minorToDecimalString(minor, digits).replace(
    '.',
    separators(locale).decimal,
  );
}

export function EditAccountDialog({
  account,
  mode,
  open,
  onClose,
}: {
  account: Account;
  /** `balance`: only the opening balance, for an account without one. */
  mode: 'edit' | 'balance';
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (changes: Changes) =>
      call(
        api.PATCH('/api/v1/accounts/{account_id}', {
          params: { path: { account_id: account.id } },
          body: changes,
        }),
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData(accountQuery(account.id).queryKey, updated);
      onClose();
      toast(t(mode === 'balance' ? 'account.balanceSaved' : 'account.saved'));
      await queryClient.invalidateQueries({
        queryKey: accountsQuery.queryKey,
        exact: true,
      });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        save.reset();
        onClose();
      }}
      busy={save.isPending}
      title={t(mode === 'balance' ? 'account.setBalance' : 'account.editTitle')}
      description={
        mode === 'balance'
          ? t('account.setBalanceSubtitle', { account: account.name })
          : t('account.editSubtitle')
      }
    >
      <EditAccountForm
        account={account}
        mode={mode}
        pending={save.isPending}
        error={save.isError ? save.error : null}
        onCancel={onClose}
        onSubmit={(changes) => {
          // Nothing changed: nothing to send.
          if (Object.keys(changes).length === 0) onClose();
          else save.mutate(changes);
        }}
      />
    </Dialog>
  );
}

function EditAccountForm({
  account,
  mode,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  account: Account;
  mode: 'edit' | 'balance';
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (changes: Changes) => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const digits = account.minor_digits;
  // What the form started from: a refetch while the dialog is open must
  // not make an untouched field look changed (and undo someone's edit).
  const [initial] = useState(() => ({
    name: account.name,
    balance: account.balance_minor ?? null,
  }));

  const form = useForm<Values>(
    {
      name: initial.name,
      balance: editableAmount(initial.balance, digits, locale),
    },
    (v) => {
      const errors: Partial<Values> = {};
      if (!v.name.trim()) errors.name = t('newAccount.errors.nameRequired');
      if (v.balance.trim()) {
        const parsed = parseAmount(v.balance, { locale, digits });
        if (!parsed.ok) errors.balance = amountError(t, parsed.error, digits);
      } else if (mode === 'balance') {
        errors.balance = t('account.balanceRequired');
      }
      return errors;
    },
  );

  const changes = (v: Values): Changes => {
    const result: Changes = {};
    const name = v.name.trim();
    if (name !== initial.name) result.name = name;
    const parsed = v.balance.trim()
      ? parseAmount(v.balance, { locale, digits })
      : null;
    const balance = parsed?.ok ? parsed.minor : null;
    if (balance !== initial.balance) {
      result.balance_minor = balance;
    }
    return result;
  };

  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={form.handleSubmit((v) => onSubmit(changes(v)))}
      noValidate
    >
      {error != null && (
        <Notice tone="negative" title={t('account.saveFailed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      {mode === 'edit' && (
        <TextField
          label={t('newAccount.name')}
          hint={t('newAccount.nameHint')}
          autoComplete="off"
          {...form.bind('name')}
        />
      )}
      <AmountField
        label={t('newAccount.balance')}
        optionalLabel={mode === 'edit' ? t('forms.optional') : undefined}
        hint={t(
          mode === 'edit' ? 'newAccount.balanceHint' : 'account.setBalanceHint',
        )}
        currencyLabel={currencySymbol(locale, account.currency)}
        {...form.bind('balance')}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="check" loading={pending}>
          {t(mode === 'balance' ? 'account.saveBalance' : 'account.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
