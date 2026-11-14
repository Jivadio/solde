// SPDX-License-Identifier: AGPL-3.0-or-later
// Transactions as a table grouped by day (DESIGN.md, DataTable). No icon
// tile per row until transactions have categories: the sign and the
// `positive` colour say which way the money went.
import { useTranslation } from 'react-i18next';
import type { Transaction } from '../api/client';
import { Amount, Badge } from '../components/Display';
import { formatDay } from '../lib/dates';
import { useFormatLocale } from '../lib/locale';

interface TransactionsTableProps {
  transactions: Transaction[];
  /** Read by screen readers as the table's name. */
  caption: string;
  /** Account names by id: shown under each label (the overview). */
  accountNames?: ReadonlyMap<string, string>;
  /** A row just added, flashed once. */
  highlightId?: string | null;
  /**
   * Group rows under day headings (an account's history). Off for a short
   * list (the overview), where the day goes under the label instead.
   */
  grouped?: boolean;
}

/** Consecutive transactions on the same booking day. */
function byDay(transactions: Transaction[]) {
  const groups: Array<{ day: string; rows: Transaction[] }> = [];
  for (const transaction of transactions) {
    const last = groups.at(-1);
    if (last && last.day === transaction.booking_date) {
      last.rows.push(transaction);
    } else {
      groups.push({ day: transaction.booking_date, rows: [transaction] });
    }
  }
  return groups;
}

export function TransactionsTable({
  transactions,
  caption,
  accountNames,
  highlightId,
  grouped = true,
}: TransactionsTableProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  return (
    <table className="sd-table sd-table--transactions">
      <caption className="sd-visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="caption">
            {t('transactions.columns.description')}
          </th>
          <th scope="col" className="caption">
            {t('transactions.columns.status')}
          </th>
          <th scope="col" className="caption sd-table__num">
            {t('transactions.columns.amount')}
          </th>
        </tr>
      </thead>
      {(grouped ? byDay(transactions) : [{ day: '', rows: transactions }]).map(
        ({ day, rows }) => (
          <tbody key={day}>
            {grouped && (
              <tr className="sd-table__day">
                <th scope="rowgroup" colSpan={3} className="overline">
                  {formatDay(day, locale)}
                </th>
              </tr>
            )}
            {rows.map((transaction) => {
              const pending = transaction.status === 'pending';
              const account = accountNames?.get(transaction.account_id);
              return (
                <tr
                  key={transaction.id}
                  className={[
                    'sd-table__row',
                    pending ? 'sd-table__row--pending' : '',
                    transaction.id === highlightId ? 'sd-table__row--new' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="sd-table__main">
                    {/* User or bank text: shown as-is, never translated. */}
                    <span className="body sd-table__label">
                      {transaction.label}
                    </span>
                    {!grouped && (
                      <span className="caption sd-muted">
                        {account
                          ? t('transactions.accountOnDay', {
                              account,
                              date: formatDay(transaction.booking_date, locale),
                            })
                          : formatDay(transaction.booking_date, locale)}
                      </span>
                    )}
                  </td>
                  <td className="sd-table__status">
                    {pending && (
                      <Badge tone="warning" icon="clock">
                        {t('transactions.pending')}
                      </Badge>
                    )}
                  </td>
                  <td className="sd-table__num">
                    <Amount
                      value={transaction.amount_minor}
                      currency={transaction.currency}
                      digits={transaction.minor_digits}
                      signed
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ),
      )}
    </table>
  );
}
