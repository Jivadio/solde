// SPDX-License-Identifier: AGPL-3.0-or-later
// Router-level states: first load, unreachable server, unknown path.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../api/errors';
import { meQuery } from '../api/queries';
import { buttonClass, Button } from '../components/Button';
import { Notice } from '../components/Display';
import { EmptyState } from '../components/States';
import { AppShell } from './AppLayout';
import { Gate, PageHeader } from './common';

export function RootPending() {
  const { t } = useTranslation();
  return (
    <div className="sd-loading body" role="status">
      {t('common.loading')}
    </div>
  );
}

export function RootError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <Gate title={t('system.errorTitle')} intro={t('system.errorIntro')}>
      <Notice tone="negative">{errorMessage(t, error)}</Notice>
      <Button
        onClick={() => {
          queryClient.removeQueries();
          void router.invalidate();
        }}
      >
        {t('common.retry')}
      </Button>
    </Gate>
  );
}

/** Unknown path: inside the app shell when signed in, so the navigation stays. */
export function NotFoundScreen() {
  const { t } = useTranslation();
  const { data: me, isPending } = useQuery(meQuery);
  if (isPending) return <RootPending />;
  const home = (
    <Link to="/" className={buttonClass('primary')}>
      {t('system.backHome')}
    </Link>
  );
  if (me) {
    return (
      <AppShell>
        <PageHeader title={t('system.notFoundTitle')} />
        <EmptyState icon="info" title={t('system.notFoundIntro')} action={home}>
          {t('system.notFoundBody')}
        </EmptyState>
      </AppShell>
    );
  }
  return (
    <Gate title={t('system.notFoundTitle')} intro={t('system.notFoundIntro')}>
      {home}
    </Gate>
  );
}
