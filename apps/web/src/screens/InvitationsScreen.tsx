// SPDX-License-Identifier: AGPL-3.0-or-later
// Admins invite people to the household, from a dialog. The link is shown
// once, in that dialog. A pending invitation can be revoked from its row
// menu, after a confirmation.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, call, type Invitation, type Role } from '../api/client';
import { errorMessage } from '../api/errors';
import { invitationsQuery, usersQuery } from '../api/queries';
import { Button } from '../components/Button';
import { ConfirmDialog, Dialog, DialogFooter } from '../components/Dialog';
import { Badge, Notice } from '../components/Display';
import { SegmentedControl } from '../components/Fields';
import { Menu } from '../components/Menu';
import { SecretOnce } from '../components/SecretOnce';
import { EmptyState } from '../components/States';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime } from '../lib/dates';
import { useFormatLocale } from '../lib/locale';
import { ErrorState, LoadingState, PageHeader } from './common';

/** The join link: the token sits in the fragment, never sent to a server. */
export function invitationLink(token: string, href = window.location.href) {
  const base = href.split('#')[0] ?? '';
  return `${base}#/join?token=${encodeURIComponent(token)}`;
}

function InvitationStatus({
  invitation,
  now,
}: {
  invitation: Invitation;
  now: number;
}) {
  const { t } = useTranslation();
  if (invitation.accepted_at) {
    return (
      <Badge tone="positive" icon="check">
        {t('invitations.accepted')}
      </Badge>
    );
  }
  if (new Date(invitation.expires_at).getTime() < now) {
    return <Badge>{t('invitations.expired')}</Badge>;
  }
  return (
    <Badge tone="warning" icon="clock">
      {t('invitations.pending')}
    </Badge>
  );
}

function InviteDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{
    link: string;
    expiresAt: string;
  } | null>(null);

  const create = useMutation({
    mutationFn: (role: Role) =>
      call(api.POST('/api/v1/invitations', { body: { role } })),
    onSuccess: async (result) => {
      setCreated({
        link: invitationLink(result.token),
        expiresAt: result.invitation.expires_at,
      });
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      });
    },
  });

  const close = () => {
    setCreated(null);
    create.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={create.isPending}
      title={
        created ? t('invitations.createdTitle') : t('invitations.createTitle')
      }
      description={created ? undefined : t('invitations.createSubtitle')}
    >
      {created ? (
        <div className="sd-dialog__body">
          <SecretOnce
            label={t('invitations.link')}
            value={created.link}
            onDone={close}
          >
            {t('invitations.createdBody', {
              date: formatDateTime(created.expiresAt, locale),
            })}
          </SecretOnce>
        </div>
      ) : (
        <InviteForm
          pending={create.isPending}
          error={create.isError ? create.error : null}
          onCancel={close}
          onSubmit={(role) => create.mutate(role)}
        />
      )}
    </Dialog>
  );
}

function InviteForm({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (role: Role) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Role>('member');
  return (
    <form
      className="sd-dialog__body sd-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(role);
      }}
    >
      {error != null && (
        <Notice tone="negative" title={t('invitations.createFailed')}>
          {errorMessage(t, error)}
        </Notice>
      )}
      <SegmentedControl<Role>
        label={t('invitations.role')}
        showLabel
        value={role}
        onChange={setRole}
        options={[
          { value: 'member', label: t('roles.member') },
          { value: 'admin', label: t('roles.admin') },
        ]}
      />
      <p className="caption sd-muted">
        {t(role === 'admin' ? 'roles.adminHint' : 'roles.memberHint')}
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="plus" loading={pending}>
          {t('invitations.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function InvitationsScreen() {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const invitations = useQuery(invitationsQuery);
  const users = useQuery(usersQuery);
  // When the screen opened: enough to tell expired invitations apart.
  const [now] = useState(() => Date.now());
  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const names = new Map((users.data ?? []).map((u) => [u.id, u.name]));
  const empty = invitations.data?.length === 0;

  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      call(
        api.DELETE('/api/v1/invitations/{invitation_id}', {
          params: { path: { invitation_id: invitationId } },
        }),
      ),
    onSuccess: async () => {
      setRevoking(null);
      toast(t('invitations.revoked'));
      await queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      });
    },
    // Used meanwhile, or already gone: the list is stale either way.
    onError: () =>
      void queryClient.invalidateQueries({
        queryKey: invitationsQuery.queryKey,
      }),
  });

  const inviteButton = (
    <Button icon="plus" onClick={() => setInviting(true)}>
      {t('invitations.createTitle')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('invitations.title')}
        subtitle={t('invitations.subtitle')}
        actions={invitations.data && !empty ? inviteButton : undefined}
      />
      {invitations.isPending ? (
        <LoadingState />
      ) : invitations.isError ? (
        <ErrorState
          error={invitations.error}
          onRetry={() => void invitations.refetch()}
        />
      ) : empty ? (
        <EmptyState
          icon="users"
          title={t('invitations.emptyTitle')}
          action={inviteButton}
        >
          {t('invitations.emptyBody')}
        </EmptyState>
      ) : (
        <div className="sd-card sd-card--flush">
          <table className="sd-table sd-table--invitations">
            <caption className="sd-visually-hidden">
              {t('invitations.listTitle')}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="caption">
                  {t('invitations.columns.invitation')}
                </th>
                <th scope="col" className="caption">
                  {t('invitations.columns.status')}
                </th>
                <th scope="col" className="caption">
                  {t('invitations.columns.date')}
                </th>
                <th scope="col" className="caption">
                  <span className="sd-visually-hidden">
                    {t('common.actions')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.data.map((invitation) => {
                const by = invitation.accepted_by
                  ? names.get(invitation.accepted_by)
                  : undefined;
                const date = invitation.accepted_at ?? invitation.expires_at;
                return (
                  <tr key={invitation.id} className="sd-table__row">
                    <td className="sd-table__main">
                      <span className="sd-table__stack">
                        <span className="body">
                          {t(`roles.${invitation.role}Invitation`)}
                        </span>
                        {by && (
                          <span className="caption sd-muted">
                            {t('invitations.acceptedBy', { name: by })}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="sd-table__meta">
                      <InvitationStatus invitation={invitation} now={now} />
                    </td>
                    <td className="sd-table__meta caption sd-muted">
                      <time
                        dateTime={date}
                        title={formatDateTime(date, locale)}
                      >
                        {invitation.accepted_at
                          ? t('invitations.acceptedOn', {
                              date: formatDate(date, locale),
                            })
                          : t('invitations.expiresOn', {
                              date: formatDate(date, locale),
                            })}
                      </time>
                    </td>
                    <td className="sd-table__actions">
                      {!invitation.accepted_at && (
                        <Menu
                          label={t('invitations.moreActions', {
                            date: formatDate(invitation.expires_at, locale),
                          })}
                          items={[
                            {
                              label: t('invitations.revoke'),
                              icon: 'close',
                              danger: true,
                              onSelect: () => {
                                revoke.reset();
                                setRevoking(invitation);
                              },
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={t('invitations.revokeTitle')}
        confirmLabel={t('invitations.revoke')}
        cancelLabel={t('common.cancel')}
        busy={revoke.isPending}
        error={
          revoke.isError && (
            <Notice tone="negative" title={t('invitations.revokeFailed')}>
              {errorMessage(t, revoke.error)}
            </Notice>
          )
        }
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      >
        {t('invitations.revokeBody')}
      </ConfirmDialog>
    </>
  );
}
