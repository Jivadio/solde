// SPDX-License-Identifier: AGPL-3.0-or-later
// Who may see and change an account, as a table: access changes in place,
// "Give access" and "Remove access" go through dialogs. Owners only:
// everyone else sees a notice, and the API would refuse them anyway.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  api,
  call,
  type Access,
  type Account,
  type Permission,
  type User,
} from '../api/client';
import { errorMessage } from '../api/errors';
import {
  accessQuery,
  accountQuery,
  accountsQuery,
  meQuery,
  usersQuery,
} from '../api/queries';
import { Button } from '../components/Button';
import { ConfirmDialog, Dialog, DialogFooter } from '../components/Dialog';
import { Notice } from '../components/Display';
import { Select, SelectField } from '../components/Fields';
import { Menu } from '../components/Menu';
import { AccountNotFound } from './AccountScreen';
import { ErrorState, LoadingState, PageHeader, initials } from './common';

const PERMISSIONS: Permission[] = ['read', 'write', 'owner'];

function PermissionOptions() {
  const { t } = useTranslation();
  return (
    <>
      {PERMISSIONS.map((permission) => (
        <option key={permission} value={permission}>
          {t(`permissions.${permission}`)}
        </option>
      ))}
    </>
  );
}

function useAccessMutations(account: Account) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);

  const refresh = async (userId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: accessQuery(account.id).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: accountsQuery.queryKey }),
    ]);
    if (userId === me?.user.id) {
      // The owner changed their own access: the account view changes too.
      await queryClient.invalidateQueries({
        queryKey: accountQuery(account.id).queryKey,
      });
    }
  };

  const grant = useMutation({
    mutationFn: ({
      userId,
      permission,
    }: {
      userId: string;
      permission: Permission;
    }) =>
      call(
        api.PUT('/api/v1/accounts/{account_id}/access/{user_id}', {
          params: { path: { account_id: account.id, user_id: userId } },
          body: { permission },
        }),
      ),
    onSuccess: (_, { userId }) => refresh(userId),
  });

  const revoke = useMutation({
    mutationFn: (userId: string) =>
      call(
        api.DELETE('/api/v1/accounts/{account_id}/access/{user_id}', {
          params: { path: { account_id: account.id, user_id: userId } },
        }),
      ),
    onSuccess: async (_, userId) => {
      if (userId === me?.user.id) {
        queryClient.removeQueries({
          queryKey: accountQuery(account.id).queryKey,
        });
        await queryClient.invalidateQueries({
          queryKey: accountsQuery.queryKey,
        });
        await navigate({ to: '/accounts' });
        return;
      }
      await refresh(userId);
    },
  });

  return { grant, revoke, meId: me?.user.id };
}

interface AccessRowProps {
  access: Access;
  user: User | undefined;
  isMe: boolean;
  onChange: (permission: Permission) => void;
  onRemove: () => void;
  busy: boolean;
}

function AccessRow({
  access,
  user,
  isMe,
  onChange,
  onRemove,
  busy,
}: AccessRowProps) {
  const { t } = useTranslation();
  const name = user?.name ?? t('sharing.unknownMember');
  return (
    <tr className="sd-table__row">
      <td className="sd-table__main">
        <span className="sd-table__with-icon">
          <span className="sd-avatar label" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="sd-table__stack">
            <span className="body sd-table__label">
              {isMe ? t('sharing.you', { name }) : name}
            </span>
            <span className="caption sd-muted">
              {t(`permissions.${access.permission}Hint`)}
            </span>
          </span>
        </span>
      </td>
      <td className="sd-table__control">
        <Select
          aria-label={t('sharing.permissionFor', { name })}
          value={access.permission}
          disabled={busy}
          onChange={(event) => onChange(event.target.value as Permission)}
        >
          <PermissionOptions />
        </Select>
      </td>
      <td className="sd-table__actions">
        <Menu
          label={t('sharing.moreActions', { name })}
          items={[
            {
              label: t('sharing.revokeConfirm'),
              icon: 'close',
              danger: true,
              onSelect: onRemove,
            },
          ]}
        />
      </td>
    </tr>
  );
}

function GrantDialog({
  open,
  onClose,
  candidates,
  onGrant,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  candidates: User[];
  onGrant: (userId: string, permission: Permission) => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t('sharing.grantTitle')}
      description={t('sharing.grantSubtitle')}
    >
      <GrantForm
        candidates={candidates}
        onGrant={onGrant}
        onCancel={onClose}
        busy={busy}
        error={error}
      />
    </Dialog>
  );
}

function GrantForm({
  candidates,
  onGrant,
  onCancel,
  busy,
  error,
}: {
  candidates: User[];
  onGrant: (userId: string, permission: Permission) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [userId, setUserId] = useState(candidates[0]?.id ?? '');
  const [permission, setPermission] = useState<Permission>('read');
  const selected = candidates.some((user) => user.id === userId)
    ? userId
    : (candidates[0]?.id ?? '');
  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) onGrant(selected, permission);
      }}
    >
      {error != null && (
        <Notice tone="negative" title={t('sharing.failed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      <SelectField
        label={t('sharing.member')}
        value={selected}
        onChange={(event) => setUserId(event.target.value)}
      >
        {candidates.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t('sharing.permission')}
        hint={t(`permissions.${permission}Hint`)}
        value={permission}
        onChange={(event) => setPermission(event.target.value as Permission)}
      >
        <PermissionOptions />
      </SelectField>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="plus" loading={busy}>
          {t('sharing.grant')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OwnerSharing({ account }: { account: Account }) {
  const { t } = useTranslation();
  const access = useQuery(accessQuery(account.id));
  const users = useQuery(usersQuery);
  const { grant, revoke, meId } = useAccessMutations(account);
  const [granting, setGranting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const header = (actions?: ReactNode) => (
    <PageHeader
      title={t('sharing.title')}
      subtitle={t('sharing.subtitle', { account: account.name })}
      back={{
        to: '/accounts/$accountId',
        params: { accountId: account.id },
        label: account.name,
      }}
      actions={actions}
    />
  );

  if (access.isPending || users.isPending) {
    return (
      <>
        {header()}
        <LoadingState />
      </>
    );
  }
  if (access.isError || users.isError) {
    return (
      <>
        {header()}
        <ErrorState
          error={access.error ?? users.error}
          onRetry={() => {
            void access.refetch();
            void users.refetch();
          }}
        />
      </>
    );
  }

  const byId = new Map(users.data.map((user) => [user.id, user]));
  const withAccess = new Set(access.data.map((entry) => entry.user_id));
  const candidates = users.data.filter((user) => !withAccess.has(user.id));
  const removingName = removing
    ? (byId.get(removing)?.name ?? t('sharing.unknownMember'))
    : '';

  return (
    <>
      {header(
        candidates.length > 0 ? (
          <Button icon="plus" onClick={() => setGranting(true)}>
            {t('sharing.grant')}
          </Button>
        ) : (
          <span className="caption sd-muted">
            {t('sharing.everyoneHasAccess')}
          </span>
        ),
      )}
      {grant.isError && !granting && (
        <Notice tone="negative" title={t('sharing.failed')}>
          {errorMessage(t, grant.error)}
        </Notice>
      )}
      <section className="sd-card sd-card--flush" aria-labelledby="people">
        <div className="sd-card__header">
          <h2 id="people" className="heading">
            {t('sharing.listTitle')}
          </h2>
        </div>
        <table className="sd-table sd-table--people">
          <caption className="sd-visually-hidden">
            {t('sharing.listTitle')}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="caption">
                {t('sharing.columns.person')}
              </th>
              <th scope="col" className="caption">
                {t('sharing.columns.access')}
              </th>
              <th scope="col" className="caption">
                <span className="sd-visually-hidden">
                  {t('common.actions')}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {access.data.map((entry) => (
              <AccessRow
                key={entry.user_id}
                access={entry}
                user={byId.get(entry.user_id)}
                isMe={entry.user_id === meId}
                busy={grant.isPending || revoke.isPending}
                onChange={(permission) =>
                  grant.mutate({ userId: entry.user_id, permission })
                }
                onRemove={() => {
                  revoke.reset();
                  setRemoving(entry.user_id);
                }}
              />
            ))}
          </tbody>
        </table>
      </section>
      <GrantDialog
        open={granting}
        onClose={() => {
          grant.reset();
          setGranting(false);
        }}
        candidates={candidates}
        busy={grant.isPending}
        error={grant.isError ? grant.error : null}
        onGrant={(userId, permission) =>
          grant.mutate(
            { userId, permission },
            { onSuccess: () => setGranting(false) },
          )
        }
      />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('sharing.revokeConfirm')}
        confirmLabel={t('sharing.revokeConfirm')}
        cancelLabel={t('common.cancel')}
        busy={revoke.isPending}
        error={
          revoke.isError && (
            <Notice tone="negative" title={t('sharing.failed')}>
              {errorMessage(t, revoke.error)}
            </Notice>
          )
        }
        onConfirm={() => {
          if (removing) {
            revoke.mutate(removing, { onSuccess: () => setRemoving(null) });
          }
        }}
      >
        {removing === meId
          ? t('sharing.confirmRevokeSelf')
          : t('sharing.confirmRevoke', { name: removingName })}
      </ConfirmDialog>
    </>
  );
}

export function SharingScreen({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
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

  if (account.data.permission === 'owner') {
    return <OwnerSharing account={account.data} />;
  }
  return (
    <>
      <PageHeader
        title={t('sharing.title')}
        subtitle={t('sharing.subtitle', { account: account.data.name })}
        back={{
          to: '/accounts/$accountId',
          params: { accountId },
          label: account.data.name,
        }}
      />
      <Notice tone="info" title={t('sharing.ownersOnlyTitle')}>
        {t('sharing.ownersOnlyBody')}
      </Notice>
    </>
  );
}
