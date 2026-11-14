// SPDX-License-Identifier: AGPL-3.0-or-later
// The overview (`/`): where the household stands. One total per currency
// (never converted), the visible accounts as cards, and the latest
// transactions across them.
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, Transaction } from '../api/client';
import { accountsQuery, transactionsQuery } from '../api/queries';
import { Button } from '../components/Button';
import { Amount, Card } from '../components/Display';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/States';
import { NewAccountDialog } from './NewAccountDialog';
import { TransactionsTable } from './TransactionsTable';
import {
  ErrorState,
  KIND_ICONS,
  KindLabel,
  LoadingState,
  PageHeader,
  PermissionBadge,
  maskIban,
} from './common';

/** How many transactions the overview lists. */
const LATEST = 8;

interface CurrencyTotal {
  currency: string;
  digits: number;
  /** Integer minor units; not a safe integer renders as "—". */
  total: number;
  count: number;
}

/**
 * Totals of the accounts with a known balance, one per currency, the
 * currency with the most accounts first. Sums are exact (BigInt).
 */
export function currencyTotals(accounts: Account[]): {
  totals: CurrencyTotal[];
  unknown: number;
} {
  const sums = new Map<
    string,
    { digits: number; total: bigint; count: number }
  >();
  let unknown = 0;
  for (const account of accounts) {
    if (account.current_balance_minor == null) {
      unknown += 1;
      continue;
    }
    const entry = sums.get(account.currency) ?? {
      digits: account.minor_digits,
      total: 0n,
      count: 0,
    };
    entry.total += BigInt(account.current_balance_minor);
    entry.count += 1;
    sums.set(account.currency, entry);
  }
  const totals = [...sums.entries()]
    .map(([currency, { digits, total, count }]) => ({
      currency,
      digits,
      total: Number(total),
      count,
    }))
    // Stable sort: ties keep the accounts' order.
    .sort((a, b) => b.count - a.count);
  return { totals, unknown };
}

function SummaryCard({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation();
  const { totals, unknown } = currencyTotals(accounts);
  const [main, ...others] = totals;

  if (!main) {
    return (
      <Card title={t('overview.noTotalTitle')} titleId="summary-title">
        <p className="body sd-muted">{t('overview.noTotalBody')}</p>
      </Card>
    );
  }
  return (
    <section
      className="sd-card sd-card--inverse sd-summary"
      aria-labelledby="summary-title"
    >
      <h2 id="summary-title" className="overline sd-muted">
        {t('overview.total')}
      </h2>
      <Amount
        value={main.total}
        currency={main.currency}
        digits={main.digits}
        size="xl"
        alertNegative
      />
      <p className="caption sd-muted">
        {t('overview.accountsCounted', { count: main.count })}
      </p>
      {others.length > 0 && (
        <ul className="sd-summary__others">
          {others.map((total) => (
            <li key={total.currency}>
              <Amount
                value={total.total}
                currency={total.currency}
                digits={total.digits}
                alertNegative
              />
              <span className="caption sd-muted">
                {t('overview.accountsCounted', { count: total.count })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {unknown > 0 && (
        <p className="caption sd-muted">
          {t('overview.unknownLeftOut', { count: unknown })}
        </p>
      )}
    </section>
  );
}

export function AccountCard({ account }: { account: Account }) {
  const { t } = useTranslation();
  return (
    <li className="sd-account-card">
      <span className="sd-icon-tile">
        <Icon name={KIND_ICONS[account.kind]} />
      </span>
      <div className="sd-account-card__text">
        <Link
          to="/accounts/$accountId"
          params={{ accountId: account.id }}
          className="sd-account-card__link heading"
        >
          {account.name}
        </Link>
        <span className="caption sd-muted">
          <KindLabel kind={account.kind} /> · {account.currency}
          {account.iban && ` · ${maskIban(account.iban)}`}
        </span>
      </div>
      <div className="sd-account-card__balance">
        {account.current_balance_minor == null ? (
          <span className="caption sd-muted">
            {t('accounts.balanceUnknown')}
          </span>
        ) : (
          <Amount
            value={account.current_balance_minor}
            currency={account.currency}
            digits={account.minor_digits}
            size="lg"
            alertNegative
          />
        )}
        {account.permission !== 'owner' && (
          <PermissionBadge permission={account.permission} />
        )}
      </div>
    </li>
  );
}

function LatestTransactions({ accounts }: { accounts: Account[] }) {
  const { t } = useTranslation();
  const pages = useQueries({
    queries: accounts.map((account) => transactionsQuery(account.id, LATEST)),
  });
  const names = new Map(accounts.map((a) => [a.id, a.name]));

  let body;
  if (pages.some((page) => page.isPending)) {
    body = (
      <div className="sd-card__pad">
        <LoadingState />
      </div>
    );
  } else if (pages.some((page) => page.isError)) {
    const failed = pages.find((page) => page.isError);
    body = (
      <div className="sd-card__pad">
        <ErrorState
          error={failed?.error}
          onRetry={() => pages.forEach((page) => void page.refetch())}
        />
      </div>
    );
  } else {
    const latest = pages
      .flatMap((page) => page.data ?? [])
      .sort(
        (a: Transaction, b: Transaction) =>
          b.booking_date.localeCompare(a.booking_date) ||
          b.id.localeCompare(a.id),
      )
      .slice(0, LATEST);
    body =
      latest.length === 0 ? (
        <p className="body sd-muted sd-card__pad">
          {t('overview.noTransactions')}
        </p>
      ) : (
        <TransactionsTable
          transactions={latest}
          caption={t('overview.latest')}
          accountNames={names}
          grouped={false}
        />
      );
  }
  return (
    <Card flush title={t('overview.latest')} titleId="latest-title">
      {body}
    </Card>
  );
}

export function OverviewScreen() {
  const { t } = useTranslation();
  const accounts = useQuery(accountsQuery);
  const [adding, setAdding] = useState(false);

  let content;
  if (accounts.isPending) {
    content = <LoadingState variant="page" />;
  } else if (accounts.isError) {
    content = (
      <ErrorState
        error={accounts.error}
        onRetry={() => void accounts.refetch()}
      />
    );
  } else if (accounts.data.length === 0) {
    content = (
      <EmptyState
        icon="home"
        title={t('overview.emptyTitle')}
        action={
          <Button icon="plus" onClick={() => setAdding(true)}>
            {t('accounts.add')}
          </Button>
        }
      >
        {t('overview.emptyBody')}
      </EmptyState>
    );
  } else {
    content = (
      <>
        <SummaryCard accounts={accounts.data} />
        <section className="sd-section" aria-labelledby="overview-accounts">
          <div className="sd-section__header">
            <h2 id="overview-accounts" className="heading">
              {t('nav.accounts')}
            </h2>
            <Link to="/accounts" className="sd-link label">
              {t('overview.seeAll')}
            </Link>
          </div>
          <ul className="sd-card-grid">
            {accounts.data.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
            <li>
              <button
                type="button"
                className="sd-add-card label"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" />
                {t('accounts.add')}
              </button>
            </li>
          </ul>
        </section>
        <LatestTransactions accounts={accounts.data} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('overview.title')} />
      {content}
      <NewAccountDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
