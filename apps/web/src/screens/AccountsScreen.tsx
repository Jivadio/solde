// SPDX-License-Identifier: AGPL-3.0-or-later
// Every account the member can see, as a table. "Add an account" opens a
// dialog; `/accounts/new` opens it directly, for links.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account } from '../api/client';
import { accountsQuery } from '../api/queries';
import { Button } from '../components/Button';
import { Amount } from '../components/Display';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/States';
import { NewAccountDialog } from './NewAccountDialog';
import {
  ErrorState,
  KIND_ICONS,
  KindLabel,
  LoadingState,
  PageHeader,
  PermissionBadge,
  maskIban,
} from './common';

function AccountRow({ account }: { account: Account }) {
  const { t } = useTranslation();
  return (
    <tr className="sd-table__row sd-table__row--link">
      <td className="sd-table__main">
        <span className="sd-table__with-icon">
          <span className="sd-icon-tile">
            <Icon name={KIND_ICONS[account.kind]} />
          </span>
          <span className="sd-table__stack">
            <Link
              to="/accounts/$accountId"
              params={{ accountId: account.id }}
              className="sd-table__link body"
            >
              {account.name}
            </Link>
            <span className="caption sd-muted">
              <KindLabel kind={account.kind} /> · {account.currency}
              {account.iban && ` · ${maskIban(account.iban)}`}
            </span>
          </span>
        </span>
      </td>
      <td className="sd-table__meta">
        <PermissionBadge permission={account.permission} />
      </td>
      <td className="sd-table__num">
        {account.current_balance_minor == null ? (
          <span className="caption sd-muted">
            {t('accounts.balanceUnknown')}
          </span>
        ) : (
          <Amount
            value={account.current_balance_minor}
            currency={account.currency}
            digits={account.minor_digits}
            alertNegative
          />
        )}
      </td>
    </tr>
  );
}

export function AccountsScreen({ adding = false }: { adding?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accounts = useQuery(accountsQuery);
  const [open, setOpen] = useState(adding);
  const empty = accounts.data?.length === 0;

  const close = () => {
    setOpen(false);
    if (adding) void navigate({ to: '/accounts', replace: true });
  };

  const addButton = (
    <Button icon="plus" onClick={() => setOpen(true)}>
      {t('accounts.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={accounts.data && !empty ? addButton : undefined}
      />
      {accounts.isPending ? (
        <LoadingState />
      ) : accounts.isError ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : empty ? (
        <EmptyState
          icon="grid"
          title={t('accounts.emptyTitle')}
          action={addButton}
        >
          {t('accounts.emptyBody')}
        </EmptyState>
      ) : (
        <div className="sd-card sd-card--flush">
          <table className="sd-table sd-table--accounts">
            <caption className="sd-visually-hidden">
              {t('accounts.listTitle', { count: accounts.data.length })}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="caption">
                  {t('accounts.columns.account')}
                </th>
                <th scope="col" className="caption">
                  {t('accounts.columns.access')}
                </th>
                <th scope="col" className="caption sd-table__num">
                  {t('accounts.columns.balance')}
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.data.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewAccountDialog open={open} onClose={close} />
    </>
  );
}
