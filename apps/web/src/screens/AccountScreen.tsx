// SPDX-License-Identifier: AGPL-3.0-or-later
// One account: its current balance, its transactions, and dialogs to add
// a transaction, to read the account's details and (owners) to edit it.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  api,
  call,
  type Account,
  type Transaction,
} from '../api/client';
import { errorMessage } from '../api/errors';
import {
  MAX_TRANSACTIONS_PAGE,
  TRANSACTIONS_PAGE,
  accountQuery,
  accountsQuery,
  transactionsKey,
  transactionsQuery,
} from '../api/queries';
import { Button } from '../components/Button';
import { Dialog, DialogFooter } from '../components/Dialog';
import { Amount, Badge, Card, Notice } from '../components/Display';
import { AmountField, SegmentedControl, TextField } from '../components/Fields';
import { Menu } from '../components/Menu';
import { EmptyState } from '../components/States';
import { useToast } from '../components/Toast';
import { currencySymbol } from '../lib/currencies';
import { todayIso } from '../lib/dates';
import { useFormatLocale } from '../lib/locale';
import { formatAmount, parseAmount } from '../lib/money';
import { EditAccountDialog } from './EditAccountDialog';
import { TransactionsTable } from './TransactionsTable';
import {
  ErrorState,
  KIND_ICONS,
  KindLabel,
  LoadingState,
  PageHeader,
  PermissionBadge,
  amountError,
  groupIban,
  useForm,
} from './common';

export function AccountNotFound() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t('account.notFoundTitle')}
        back={{ to: '/accounts', label: t('nav.accounts') }}
      />
      <Notice tone="info">{t('account.notFoundBody')}</Notice>
    </>
  );
}

/**
 * Money in and out this month, from the loaded page. `null` when the page
 * may not reach the start of the month, or when a total is not exact.
 */
function monthTotals(
  transactions: Transaction[],
  full: boolean,
): { in: number; out: number } | null {
  const month = todayIso().slice(0, 7);
  const oldest = transactions.at(-1);
  if (full && (!oldest || oldest.booking_date.slice(0, 7) >= month)) {
    return null;
  }
  let moneyIn = 0n;
  let moneyOut = 0n;
  for (const tx of transactions) {
    if (tx.status !== 'booked' || tx.booking_date.slice(0, 7) !== month) {
      continue;
    }
    if (tx.amount_minor > 0) moneyIn += BigInt(tx.amount_minor);
    else moneyOut += BigInt(tx.amount_minor);
  }
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (moneyIn > limit || -moneyOut > limit) return null;
  return { in: Number(moneyIn), out: Number(moneyOut) };
}

function BalanceStrip({
  account,
  month,
  onSetBalance,
}: {
  account: Account;
  month: { in: number; out: number } | null;
  /** Owners only: opens the dialog that sets the opening balance. */
  onSetBalance?: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const money = {
    currency: account.currency,
    digits: account.minor_digits,
  };

  if (account.current_balance_minor == null) {
    return (
      <Card className="sd-balance-unknown">
        <h2 className="heading">{t('account.balanceUnknownTitle')}</h2>
        <p className="body sd-muted">{t('account.balanceUnknownBody')}</p>
        {onSetBalance ? (
          <div className="sd-balance-unknown__action">
            <Button variant="secondary" onClick={onSetBalance}>
              {t('account.setBalance')}
            </Button>
          </div>
        ) : (
          <p className="caption sd-muted">
            {t('account.balanceUnknownAskOwner')}
          </p>
        )}
      </Card>
    );
  }

  return (
    <section
      className="sd-card sd-card--inverse sd-balance"
      aria-labelledby="balance-title"
    >
      <div className="sd-balance__main">
        <h2 id="balance-title" className="overline sd-muted">
          {t('account.currentBalance')}
        </h2>
        <Amount
          value={account.current_balance_minor}
          size="xl"
          alertNegative
          {...money}
        />
        {account.balance_minor != null && (
          <p className="caption sd-muted">
            {t('account.openingBalance', {
              amount: formatAmount(account.balance_minor, {
                locale,
                ...money,
              }),
            })}
          </p>
        )}
      </div>
      {month && (
        <dl className="sd-balance__month">
          <div>
            <dt className="caption sd-muted">{t('account.monthIn')}</dt>
            <dd>
              <Amount value={month.in} signed {...money} />
            </dd>
          </div>
          <div>
            <dt className="caption sd-muted">{t('account.monthOut')}</dt>
            <dd>
              <Amount value={month.out} {...money} />
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

type Direction = 'out' | 'in';

interface TransactionValues extends Record<string, string> {
  amount: string;
  label: string;
  booking_date: string;
}

function AddTransactionDialog({
  account,
  open,
  onClose,
  onAdded,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
  onAdded: (transaction: Transaction) => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const queryClient = useQueryClient();
  const toast = useToast();

  const create = useMutation({
    mutationFn: ({
      values,
      direction,
    }: {
      values: TransactionValues;
      direction: Direction;
    }) => {
      const parsed = parseAmount(values.amount, {
        locale,
        digits: account.minor_digits,
      });
      const magnitude = parsed.ok ? Math.abs(parsed.minor) : 0;
      return call(
        api.POST('/api/v1/accounts/{account_id}/transactions', {
          params: { path: { account_id: account.id } },
          body: {
            booking_date: values.booking_date,
            amount_minor: direction === 'out' ? -magnitude : magnitude,
            currency: account.currency,
            label: values.label.trim(),
          },
        }),
      );
    },
    onSuccess: async (transaction) => {
      onClose();
      toast(t('transactions.added'));
      onAdded(transaction);
      // The balance moves with every booked transaction.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: transactionsKey(account.id),
        }),
        queryClient.invalidateQueries({
          queryKey: accountQuery(account.id).queryKey,
          exact: true,
        }),
        queryClient.invalidateQueries({
          queryKey: accountsQuery.queryKey,
          exact: true,
        }),
      ]);
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
      title={t('transactions.addTitle')}
      description={t('transactions.addSubtitle', { account: account.name })}
    >
      <TransactionForm
        account={account}
        pending={create.isPending}
        error={create.isError ? create.error : null}
        onCancel={onClose}
        onSubmit={(values, direction) => create.mutate({ values, direction })}
      />
    </Dialog>
  );
}

function TransactionForm({
  account,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  account: Account;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: TransactionValues, direction: Direction) => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const [direction, setDirection] = useState<Direction>('out');
  const digits = account.minor_digits;

  const form = useForm<TransactionValues>(
    { amount: '', label: '', booking_date: todayIso() },
    (v) => {
      const errors: Partial<TransactionValues> = {};
      const parsed = parseAmount(v.amount, { locale, digits });
      if (!parsed.ok) {
        errors.amount = amountError(t, parsed.error, digits);
      } else if (parsed.minor === 0) {
        errors.amount = t('transactions.errors.amountZero');
      }
      if (!v.label.trim())
        errors.label = t('transactions.errors.labelRequired');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.booking_date))
        errors.booking_date = t('transactions.errors.dateRequired');
      return errors;
    },
  );

  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={form.handleSubmit((v) => onSubmit(v, direction))}
      noValidate
    >
      {error != null && (
        <Notice tone="negative" title={t('transactions.addFailed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      <SegmentedControl<Direction>
        label={t('transactions.direction')}
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'out', label: t('transactions.moneyOut') },
          { value: 'in', label: t('transactions.moneyIn') },
        ]}
      />
      <AmountField
        label={t('transactions.amount')}
        currencyLabel={currencySymbol(locale, account.currency)}
        {...form.bind('amount')}
      />
      <TextField
        label={t('transactions.label')}
        hint={t('transactions.labelHint')}
        autoComplete="off"
        {...form.bind('label')}
      />
      <TextField
        label={t('transactions.date')}
        type="date"
        {...form.bind('booking_date')}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="plus" loading={pending}>
          {t('transactions.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AccountDetailsDialog({
  account,
  open,
  onClose,
}: {
  account: Account;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const currencyName =
    new Intl.DisplayNames([locale], { type: 'currency' }).of(
      account.currency,
    ) ?? account.currency;
  return (
    <Dialog open={open} onClose={onClose} title={t('account.details')}>
      <div className="sd-dialog__body">
        <dl className="sd-details">
          <div>
            <dt className="caption sd-muted">{t('account.name')}</dt>
            <dd className="body">{account.name}</dd>
          </div>
          <div>
            <dt className="caption sd-muted">{t('newAccount.kind')}</dt>
            <dd className="body">
              <KindLabel kind={account.kind} />
            </dd>
          </div>
          <div>
            <dt className="caption sd-muted">{t('newAccount.currency')}</dt>
            <dd className="body">{`${account.currency} · ${currencyName}`}</dd>
          </div>
          <div>
            <dt className="caption sd-muted">{t('newAccount.iban')}</dt>
            <dd className="body sd-iban">
              {account.iban ? groupIban(account.iban) : t('account.noIban')}
            </dd>
          </div>
          <div>
            <dt className="caption sd-muted">
              {t('account.openingBalanceLabel')}
            </dt>
            <dd className="body">
              {account.balance_minor == null ? (
                t('account.notRecorded')
              ) : (
                <Amount
                  value={account.balance_minor}
                  currency={account.currency}
                  digits={account.minor_digits}
                />
              )}
            </dd>
          </div>
          <div>
            <dt className="caption sd-muted">{t('account.yourAccess')}</dt>
            <dd className="body">{t(`permissions.${account.permission}`)}</dd>
          </div>
        </dl>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

function TransactionsCard({
  account,
  transactions,
  limit,
  onLoadMore,
  canWrite,
  onAdd,
  highlightId,
}: {
  account: Account;
  transactions: ReturnType<typeof useAccountTransactions>;
  limit: number;
  onLoadMore: () => void;
  canWrite: boolean;
  onAdd: () => void;
  highlightId: string | null;
}) {
  const { t } = useTranslation();
  // A full page means there may be older ones.
  const full = transactions.data?.length === limit;
  return (
    <Card flush title={t('transactions.title')} titleId="transactions-title">
      {transactions.isPending ? (
        <div className="sd-card__pad">
          <LoadingState />
        </div>
      ) : transactions.isError ? (
        <div className="sd-card__pad">
          <ErrorState
            error={transactions.error}
            onRetry={() => void transactions.refetch()}
          />
        </div>
      ) : transactions.data.length === 0 ? (
        <EmptyState
          level={3}
          icon="clock"
          title={t('transactions.emptyTitle')}
          action={
            canWrite && (
              <Button variant="secondary" icon="plus" onClick={onAdd}>
                {t('transactions.addTitle')}
              </Button>
            )
          }
        >
          {canWrite
            ? t('transactions.emptyBody')
            : t('transactions.emptyBodyReadOnly')}
        </EmptyState>
      ) : (
        <>
          <TransactionsTable
            transactions={transactions.data}
            caption={t('transactions.caption', { account: account.name })}
            highlightId={highlightId}
          />
          {full && (
            <div className="sd-list-footer">
              <p className="caption sd-muted">
                {t('transactions.showingLatest', { count: limit })}
              </p>
              {limit < MAX_TRANSACTIONS_PAGE && (
                <Button
                  variant="secondary"
                  loading={transactions.isFetching}
                  onClick={onLoadMore}
                >
                  {t('transactions.loadMore')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function useAccountTransactions(accountId: string, limit: number) {
  return useQuery({
    ...transactionsQuery(accountId, limit),
    // Keep the rows on screen while a larger page loads.
    placeholderData: keepPreviousData,
  });
}

function AccountView({ account }: { account: Account }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [limit, setLimit] = useState(TRANSACTIONS_PAGE);
  const [dialog, setDialog] = useState<
    'add' | 'details' | 'edit' | 'balance' | null
  >(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const transactions = useAccountTransactions(account.id, limit);

  const isOwner = account.permission === 'owner';
  const canWrite = isOwner || account.permission === 'write';
  // While a larger page loads, the previous one is shown: not a full month.
  const month =
    transactions.data && !transactions.isPlaceholderData
      ? monthTotals(transactions.data, transactions.data.length === limit)
      : null;
  // An empty list has its own add action (DESIGN.md: one primary action).
  const emptyList = transactions.data?.length === 0;

  return (
    <>
      <PageHeader
        title={account.name}
        back={{ to: '/accounts', label: t('nav.accounts') }}
        subtitle={
          <span className="sd-row">
            <Badge icon={KIND_ICONS[account.kind]}>
              <KindLabel kind={account.kind} />
            </Badge>
            <PermissionBadge permission={account.permission} />
            {!canWrite && (
              <span className="caption">{t('account.readOnlyBody')}</span>
            )}
          </span>
        }
        actions={
          <>
            {canWrite && !emptyList && (
              <Button icon="plus" onClick={() => setDialog('add')}>
                {t('transactions.addTitle')}
              </Button>
            )}
            <Menu
              label={t('account.moreActions', { account: account.name })}
              items={[
                ...(isOwner
                  ? [
                      {
                        label: t('account.edit'),
                        icon: 'pencil' as const,
                        onSelect: () => setDialog('edit'),
                      },
                      {
                        label: t('account.manageSharing'),
                        icon: 'users' as const,
                        onSelect: () =>
                          void navigate({
                            to: '/accounts/$accountId/sharing',
                            params: { accountId: account.id },
                          }),
                      },
                    ]
                  : []),
                {
                  label: t('account.details'),
                  icon: 'info',
                  onSelect: () => setDialog('details'),
                },
              ]}
            />
          </>
        }
      />
      <BalanceStrip
        account={account}
        month={month}
        onSetBalance={isOwner ? () => setDialog('balance') : undefined}
      />
      <TransactionsCard
        account={account}
        transactions={transactions}
        limit={limit}
        onLoadMore={() =>
          setLimit((current) =>
            Math.min(current + TRANSACTIONS_PAGE, MAX_TRANSACTIONS_PAGE),
          )
        }
        canWrite={canWrite}
        onAdd={() => setDialog('add')}
        highlightId={highlightId}
      />
      {canWrite && (
        <AddTransactionDialog
          account={account}
          open={dialog === 'add'}
          onClose={() => setDialog(null)}
          onAdded={(transaction) => setHighlightId(transaction.id)}
        />
      )}
      <AccountDetailsDialog
        account={account}
        open={dialog === 'details'}
        onClose={() => setDialog(null)}
      />
      {isOwner && (
        <EditAccountDialog
          account={account}
          mode={dialog === 'balance' ? 'balance' : 'edit'}
          open={dialog === 'edit' || dialog === 'balance'}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

export function AccountScreen({ accountId }: { accountId: string }) {
  const account = useQuery(accountQuery(accountId));

  if (account.isPending) return <LoadingState variant="page" />;
  if (account.isError) {
    if (account.error instanceof ApiError && account.error.status === 404) {
      return <AccountNotFound />;
    }
    return (
      <ErrorState
        error={account.error}
        onRetry={() => void account.refetch()}
      />
    );
  }
  return <AccountView account={account.data} />;
}
