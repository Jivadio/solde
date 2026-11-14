// SPDX-License-Identifier: AGPL-3.0-or-later
// API tokens for scripts and remote clients. A token is created in a
// dialog and shown once there; deleting one asks first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, call, type ApiToken } from '../api/client';
import { errorMessage } from '../api/errors';
import { tokensQuery } from '../api/queries';
import { Button } from '../components/Button';
import { ConfirmDialog, Dialog, DialogFooter } from '../components/Dialog';
import { Notice } from '../components/Display';
import { SelectField, TextField } from '../components/Fields';
import { Menu } from '../components/Menu';
import { SecretOnce } from '../components/SecretOnce';
import { EmptyState } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime } from '../lib/dates';
import { useFormatLocale } from '../lib/locale';
import { ErrorState, LoadingState, PageHeader, useForm } from './common';

const EXPIRY_OPTIONS = ['30', '90', '365', 'never'] as const;
type Expiry = (typeof EXPIRY_OPTIONS)[number];

interface TokenValues extends Record<string, string> {
  name: string;
  expiry: string;
}

/** A date cell: the day, with the time on hover. */
function When({ at }: { at: string }) {
  const locale = useFormatLocale();
  return (
    <time dateTime={at} title={formatDateTime(at, locale)}>
      {formatDate(at, locale)}
    </time>
  );
}

function TokenRow({
  token,
  onDelete,
}: {
  token: ApiToken;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="sd-table__row">
      <td className="sd-table__main">
        <span className="body sd-table__label">{token.name}</span>
      </td>
      <td className="sd-table__meta caption sd-muted">
        <span className="sd-table__cell-label">
          {t('tokens.columns.created')}{' '}
        </span>
        <When at={token.created_at} />
      </td>
      <td className="sd-table__meta caption sd-muted">
        {token.expires_at ? (
          <>
            <span className="sd-table__cell-label">
              {t('tokens.columns.expires')}{' '}
            </span>
            <When at={token.expires_at} />
          </>
        ) : (
          t('tokens.neverExpires')
        )}
      </td>
      <td className="sd-table__meta caption sd-muted">
        {token.last_used_at ? (
          <>
            <span className="sd-table__cell-label">
              {t('tokens.columns.lastUsed')}{' '}
            </span>
            <When at={token.last_used_at} />
          </>
        ) : (
          t('tokens.neverUsed')
        )}
      </td>
      <td className="sd-table__actions">
        <Menu
          label={t('tokens.moreActions', { name: token.name })}
          items={[
            {
              label: t('tokens.delete'),
              icon: 'close',
              danger: true,
              onSelect: onDelete,
            },
          ]}
        />
      </td>
    </tr>
  );
}

function CreateTokenDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (v: TokenValues) =>
      call(
        api.POST('/api/v1/tokens', {
          body: {
            name: v.name.trim(),
            expires_in_days:
              (v.expiry as Expiry) === 'never' ? null : Number(v.expiry),
          },
        }),
      ),
    onSuccess: async (result) => {
      setSecret(result.secret);
      await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey });
    },
  });

  const close = () => {
    setSecret(null);
    create.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={create.isPending}
      title={secret ? t('tokens.createdTitle') : t('tokens.createTitle')}
      description={secret ? undefined : t('tokens.subtitle')}
    >
      {secret ? (
        <div className="sd-dialog__body">
          <SecretOnce label={t('tokens.secret')} value={secret} onDone={close}>
            {t('tokens.createdBody', { header: 'Authorization: Bearer' })}
          </SecretOnce>
        </div>
      ) : (
        <TokenForm
          pending={create.isPending}
          error={create.isError ? create.error : null}
          onCancel={close}
          onSubmit={(values) => create.mutate(values)}
        />
      )}
    </Dialog>
  );
}

function TokenForm({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (values: TokenValues) => void;
}) {
  const { t } = useTranslation();
  const form = useForm<TokenValues>({ name: '', expiry: '90' }, (v) => {
    const errors: Partial<TokenValues> = {};
    if (!v.name.trim()) errors.name = t('tokens.errors.nameRequired');
    return errors;
  });
  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      {error != null && (
        <Notice tone="negative" title={t('tokens.createFailed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      <TextField
        label={t('tokens.name')}
        hint={t('tokens.nameHint')}
        autoComplete="off"
        {...form.bind('name')}
      />
      <SelectField label={t('tokens.expiry')} {...form.bind('expiry')}>
        {EXPIRY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'never'
              ? t('tokens.expiryNever')
              : t('tokens.expiryDays', { days: Number(option) })}
          </option>
        ))}
      </SelectField>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="plus" loading={pending}>
          {t('tokens.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TokensScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const tokens = useQuery(tokensQuery);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApiToken | null>(null);
  const empty = tokens.data?.length === 0;

  const remove = useMutation({
    mutationFn: (tokenId: string) =>
      call(
        api.DELETE('/api/v1/tokens/{token_id}', {
          params: { path: { token_id: tokenId } },
        }),
      ),
    onSuccess: async () => {
      setDeleting(null);
      toast(t('tokens.deleted'));
      await queryClient.invalidateQueries({ queryKey: tokensQuery.queryKey });
    },
  });

  const createButton = (
    <Button icon="plus" onClick={() => setCreating(true)}>
      {t('tokens.createTitle')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('tokens.title')}
        subtitle={t('tokens.subtitle')}
        actions={tokens.data && !empty ? createButton : undefined}
      />
      {tokens.isPending ? (
        <LoadingState />
      ) : tokens.isError ? (
        <ErrorState
          error={tokens.error}
          onRetry={() => void tokens.refetch()}
        />
      ) : empty ? (
        <EmptyState
          icon="key"
          title={t('tokens.emptyTitle')}
          action={createButton}
        >
          {t('tokens.emptyBody')}
        </EmptyState>
      ) : (
        <div className="sd-card sd-card--flush">
          <table className="sd-table sd-table--tokens">
            <caption className="sd-visually-hidden">
              {t('tokens.listTitle')}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="caption">
                  {t('tokens.columns.name')}
                </th>
                <th scope="col" className="caption">
                  {t('tokens.columns.created')}
                </th>
                <th scope="col" className="caption">
                  {t('tokens.columns.expires')}
                </th>
                <th scope="col" className="caption">
                  {t('tokens.columns.lastUsed')}
                </th>
                <th scope="col" className="caption">
                  <span className="sd-visually-hidden">
                    {t('common.actions')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  onDelete={() => {
                    remove.reset();
                    setDeleting(token);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateTokenDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('tokens.deleteConfirm')}
        confirmLabel={t('tokens.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        busy={remove.isPending}
        error={
          remove.isError && (
            <Notice tone="negative" title={t('tokens.deleteFailed')}>
              {errorMessage(t, remove.error)}
            </Notice>
          )
        }
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        {t('tokens.confirmDelete', { name: deleting?.name ?? '' })}
      </ConfirmDialog>
    </>
  );
}
