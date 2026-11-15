// SPDX-License-Identifier: AGPL-3.0-or-later
// Shell of the signed-in app (DESIGN.md, AppShell): a sidebar from the
// `lg` breakpoint, a top bar and a bottom tab bar below it. Signing out
// lives in the member menu, never next to the destinations. When the
// server sends the session cookie over plain HTTP, every screen says so.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, call, type Me } from '../api/client';
import { errorMessage } from '../api/errors';
import { meQuery } from '../api/queries';
import { Notice } from '../components/Display';
import { Icon, type IconName } from '../components/Icon';
import { Menu } from '../components/Menu';
import { ToastProvider } from '../components/Toast';
import { Wordmark, initials } from './common';

type Destination = '/' | '/accounts' | '/invitations' | '/tokens';

/** Where the self-hosting guide explains plain-HTTP setups and HTTPS. */
export const SELF_HOSTING_GUIDE =
  'https://github.com/Jivadio/solde/blob/main/docs/self-hosting.md#on-a-home-network-without-https';

/**
 * The server runs with `SOLDE_INSECURE_COOKIES=1`. Shown to every member
 * (each one's session is exposed), on every screen, and never dismissed:
 * it lasts as long as the setting. Admins can change it, so they read
 * which setting it is; members are told whom to ask.
 */
export function InsecureCookiesNotice({ me }: { me: Me }) {
  const { t } = useTranslation();
  return (
    <Notice tone="warning" title={t('insecureCookies.title')}>
      <p>
        {me.user.role === 'admin'
          ? t('insecureCookies.bodyAdmin', {
              setting: 'SOLDE_INSECURE_COOKIES=1',
            })
          : t('insecureCookies.bodyMember')}
      </p>
      <p>
        <a
          className="sd-link"
          href={SELF_HOSTING_GUIDE}
          target="_blank"
          rel="noreferrer"
        >
          {t('insecureCookies.guide')}
        </a>
      </p>
    </Notice>
  );
}

interface NavItem {
  to: Destination;
  label: string;
  icon: IconName;
}

function useNavItems(me: Me | null | undefined) {
  const { t } = useTranslation();
  const main: NavItem[] = [
    { to: '/', label: t('nav.overview'), icon: 'home' },
    { to: '/accounts', label: t('nav.accounts'), icon: 'grid' },
  ];
  const household: NavItem[] = [
    ...(me?.user.role === 'admin'
      ? [
          {
            to: '/invitations' as const,
            label: t('nav.invitations'),
            icon: 'users' as const,
          },
        ]
      : []),
    { to: '/tokens', label: t('nav.tokens'), icon: 'key' },
  ];
  return { main, household };
}

function NavLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className="sd-nav__link"
    >
      <span className="sd-nav__icon">
        <Icon name={item.icon} size={20} />
      </span>
      <span className="sd-nav__text label">{item.label}</span>
    </Link>
  );
}

function MemberMenu({
  me,
  compact,
  onLogoutError,
}: {
  me: Me;
  compact: boolean;
  onLogoutError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Local state is cleared only once the server has closed the session.
  // A 401 means it is already closed (the app-wide handler signs out); any
  // other failure keeps the person here with an error, and signing out
  // again retries.
  const logout = useMutation({
    mutationFn: () => call(api.POST('/api/v1/auth/logout')),
    onMutate: () => onLogoutError(null),
    onSuccess: async () => {
      queryClient.removeQueries();
      queryClient.setQueryData(meQuery.queryKey, null);
      await navigate({ to: '/login', search: {} });
    },
    onError: (error) => {
      if (!(error instanceof ApiError && error.status === 401)) {
        onLogoutError(error);
      }
    },
  });
  const avatar = (
    <span className="sd-avatar label" aria-hidden="true">
      {initials(me.user.name)}
    </span>
  );
  return (
    <Menu
      label={t('nav.memberMenu', { name: me.user.name })}
      up={!compact}
      alignStart={!compact}
      triggerHasText={!compact}
      triggerClassName={compact ? 'sd-icon-button' : 'sd-member'}
      trigger={
        compact ? (
          avatar
        ) : (
          <>
            {avatar}
            <span className="sd-member__text">
              <span className="label">{me.user.name}</span>
              <span className="caption sd-muted">
                {t(`roles.${me.user.role}`)}
              </span>
            </span>
            <Icon name="more" size={18} className="sd-muted" />
          </>
        )
      }
      items={[
        {
          label: t('nav.signOut'),
          icon: 'logout',
          onSelect: () => logout.mutate(),
        },
      ]}
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { data: me } = useQuery(meQuery);
  const { main, household } = useNavItems(me);
  const [logoutError, setLogoutError] = useState<unknown>(null);

  return (
    <ToastProvider>
      <div className="sd-shell">
        {/* Hash routing owns the URL fragment: focus <main> by hand. */}
        <a
          href="#main"
          className="sd-skip label"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('main')?.focus();
          }}
        >
          {t('nav.skipToContent')}
        </a>

        <header className="sd-topbar">
          <Link to="/" className="sd-topbar__brand" aria-label={t('nav.home')}>
            <Wordmark small />
          </Link>
          {me && (
            <span className="caption sd-muted sd-topbar__household">
              {me.household.name}
            </span>
          )}
          {me && <MemberMenu me={me} compact onLogoutError={setLogoutError} />}
        </header>

        {/* One navigation: the sidebar from `lg`, the bottom tab bar below. */}
        <aside className="sd-sidebar">
          <Link to="/" className="sd-sidebar__brand" aria-label={t('nav.home')}>
            <Wordmark small />
          </Link>
          {me && (
            <p className="caption sd-muted sd-sidebar__household">
              {me.household.name}
            </p>
          )}
          <nav className="sd-nav" aria-label={t('nav.label')}>
            <ul className="sd-nav__list" data-count={main.length}>
              {main.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
            <p className="overline sd-muted sd-nav__group">
              {t('nav.household')}
            </p>
            <ul className="sd-nav__list" data-count={household.length}>
              {household.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} />
                </li>
              ))}
            </ul>
          </nav>
          {me && (
            <div className="sd-sidebar__member">
              <MemberMenu
                me={me}
                compact={false}
                onLogoutError={setLogoutError}
              />
            </div>
          )}
        </aside>

        <main id="main" className="sd-main" tabIndex={-1}>
          <div className="sd-main__inner">
            {me?.insecure_cookies && <InsecureCookiesNotice me={me} />}
            {logoutError !== null && (
              <Notice tone="negative">{errorMessage(t, logoutError)}</Notice>
            )}
            {children}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

export function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
