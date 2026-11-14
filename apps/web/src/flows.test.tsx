// SPDX-License-Identifier: AGPL-3.0-or-later
// Whole-app flows against an in-memory API (see test/fakeApi.ts).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from './api/client';
import {
  JANE,
  JOHN,
  SETUP_CODE,
  emptyState,
  householdState,
  installFakeApi,
} from './test/fakeApi';
import { renderApp } from './test/render';

const JOINT: Account = {
  id: '00000000-0000-7000-8000-0000000000a1',
  name: 'Joint current account',
  kind: 'checking',
  currency: 'EUR',
  minor_digits: 2,
  iban: 'FR76 0000 0000 0000 0000 0000 000',
  balance_minor: null,
  permission: 'owner',
};

function sharedHousehold(session: string) {
  return householdState({
    session,
    accounts: [JOINT],
    access: {
      [JOINT.id]: [
        { user_id: JANE.user.id, permission: 'owner' },
        { user_id: JOHN.user.id, permission: 'read' },
      ],
    },
    transactions: {
      [JOINT.id]: [
        {
          id: '00000000-0000-7000-8000-0000000000t1',
          account_id: JOINT.id,
          booking_date: '2026-10-28',
          value_date: null,
          amount_minor: -4290,
          currency: 'EUR',
          minor_digits: 2,
          label: 'Groceries',
          status: 'booked',
        },
      ],
    },
  });
}

describe('route guard', () => {
  it('sends everyone to setup until the instance is set up', async () => {
    installFakeApi(emptyState());
    const { router } = renderApp('/accounts');
    expect(
      await screen.findByRole('heading', { name: 'Set up Solde' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('sends signed-out people to login, remembering where they were going', async () => {
    installFakeApi(householdState());
    const { router } = renderApp(`/accounts/${JOINT.id}`);
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({
      redirect: `/accounts/${JOINT.id}`,
    });
  });

  it('leaves setup once the instance is set up', async () => {
    installFakeApi(householdState());
    const { router } = renderApp('/setup');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('skips login when already signed in', async () => {
    installFakeApi(householdState({ session: JANE.user.id }));
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps members out of the admin-only invitations screen', async () => {
    installFakeApi(householdState({ session: JOHN.user.id }));
    const { router } = renderApp('/invitations');
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(router.state.location.pathname).toBe('/');
    expect(
      screen.queryByRole('link', { name: 'Invitations' }),
    ).not.toBeInTheDocument();
  });
});

describe('first launch', () => {
  it('sets up the household, signs out, then signs back in', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(emptyState());
    renderApp('/');

    await screen.findByRole('heading', { name: 'Set up Solde' });
    await user.click(
      screen.getByRole('button', { name: 'Create the household' }),
    );
    // Client-side checks first, with the first invalid field focused.
    expect(screen.getByLabelText('Setup code')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByLabelText('Setup code')).toHaveFocus();
    expect(screen.getByLabelText('Household name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(requests.some((r) => r.path === '/setup')).toBe(false);

    // A wrong code is refused by the server, with a translated message.
    await user.type(screen.getByLabelText('Setup code'), 'WRONG-CODE');
    await user.type(screen.getByLabelText('Household name'), 'Doe family');
    await user.type(screen.getByLabelText('Your name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Email'), JANE.email);
    await user.type(screen.getByLabelText('Password'), JANE.password);
    await user.click(
      screen.getByRole('button', { name: 'Create the household' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This setup code is wrong.',
    );

    await user.clear(screen.getByLabelText('Setup code'));
    await user.type(screen.getByLabelText('Setup code'), SETUP_CODE);
    await user.click(
      screen.getByRole('button', { name: 'Create the household' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Start with your first account' }),
    ).toBeInTheDocument();
    const setup = requests.findLast((r) => r.path === '/setup');
    expect(setup).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      body: {
        setup_code: SETUP_CODE,
        household_name: 'Doe family',
        name: 'Jane Doe',
        email: JANE.email,
      },
    });

    await user.click(
      screen.getAllByRole('button', { name: 'Account menu for Jane Doe' })[0]!,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(requests.find((r) => r.path === '/auth/logout')).toMatchObject({
      contentType: 'application/json',
    });

    await user.type(screen.getByLabelText('Email'), JANE.email);
    await user.type(screen.getByLabelText('Password'), 'wrong password!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wrong email or password.',
    );
    expect(screen.queryByText('fixed english message')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), JANE.password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument();
  });
});

describe('end of a session', () => {
  const PRIVATE: Account = {
    ...JOINT,
    id: '00000000-0000-7000-8000-0000000000a2',
    name: 'Jane private savings',
  };

  it('drops the previous member’s data when the session expires', async () => {
    const state = householdState({
      session: JANE.user.id,
      accounts: [PRIVATE],
      access: {
        [PRIVATE.id]: [{ user_id: JANE.user.id, permission: 'owner' }],
      },
    });
    installFakeApi(state);
    const user = userEvent.setup();
    renderApp('/accounts');
    expect(await screen.findByText(PRIVATE.name)).toBeInTheDocument();

    // The server ends the session; the next call answers 401.
    state.session = null;
    await user.click(screen.getByRole('link', { name: 'API tokens' }));
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.type(screen.getByLabelText('Email'), JOHN.email);
    await user.type(screen.getByLabelText('Password'), JOHN.password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // Back where the 401 happened, then to the accounts list.
    await screen.findByRole('heading', { name: 'API tokens' });
    await user.click(screen.getByRole('link', { name: 'Accounts' }));
    await screen.findByRole('heading', { name: 'Accounts' });
    expect(screen.queryByText(PRIVATE.name)).not.toBeInTheDocument();
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('stays signed in, with an error, when signing out fails', async () => {
    installFakeApi(householdState({ session: JANE.user.id, failLogout: true }));
    const user = userEvent.setup();
    const { router } = renderApp('/accounts');
    await screen.findByRole('heading', { name: 'Accounts' });
    await user.click(
      screen.getAllByRole('button', { name: 'Account menu for Jane Doe' })[0]!,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server.',
    );
    expect(router.state.location.pathname).toBe('/accounts');
  });
});

describe('accounts and transactions', () => {
  it('adds an account with its balance, then a transaction typed with a decimal comma', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({ session: JANE.user.id }),
    );
    renderApp('/accounts');

    // The empty list has one "Add an account" button, not two.
    const add = await screen.findAllByRole('button', {
      name: 'Add an account',
    });
    expect(add).toHaveLength(1);
    await user.click(add[0]!);
    const dialog = await screen.findByRole('dialog', {
      name: 'Add an account',
    });
    expect(within(dialog).getByLabelText('Account name')).toHaveFocus();
    await user.type(
      within(dialog).getByLabelText('Account name'),
      'Savings book',
    );
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'savings');
    await user.type(
      within(dialog).getByLabelText(/Current balance/),
      '1 240,50',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Add the account' }),
    );

    await screen.findByRole('heading', { name: 'Savings book', level: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Account added.',
    );
    expect(
      requests.find((r) => r.path === '/accounts' && r.method === 'POST'),
    ).toMatchObject({
      body: {
        name: 'Savings book',
        kind: 'savings',
        currency: 'EUR',
        iban: null,
        balance_minor: 124050,
      },
    });
    const balance = screen.getByRole('region', { name: 'Current balance' });
    expect(balance).toHaveTextContent('€1,240.50');
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    // An empty list has one add action, in its empty state.
    expect(
      screen.getAllByRole('button', { name: 'Add a transaction' }),
    ).toHaveLength(1);

    await user.click(
      screen.getAllByRole('button', { name: 'Add a transaction' })[0]!,
    );
    const sheet = await screen.findByRole('dialog', {
      name: 'Add a transaction',
    });
    await user.type(within(sheet).getByLabelText('Amount'), '12,5');
    await user.type(within(sheet).getByLabelText('Label'), 'Bakery');
    await user.click(
      within(sheet).getByRole('button', { name: 'Add the transaction' }),
    );

    const table = await screen.findByRole('table', {
      name: 'Transactions of Savings book, newest first',
    });
    expect(within(table).getByText('Bakery')).toBeInTheDocument();
    expect(within(table).getByText('−€12.50')).toBeInTheDocument();
    expect(
      requests.find(
        (r) => r.path.endsWith('/transactions') && r.method === 'POST',
      ),
    ).toMatchObject({
      body: { amount_minor: -1250, currency: 'EUR', label: 'Bakery' },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The balance follows the new transaction.
    await waitFor(() => expect(balance).toHaveTextContent('€1,228.00'));
  });

  it('refuses a balance it cannot read, inside the dialog', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({ session: JANE.user.id }),
    );
    renderApp('/accounts/new');

    const dialog = await screen.findByRole('dialog', {
      name: 'Add an account',
    });
    await user.type(within(dialog).getByLabelText('Account name'), 'Typo');
    await user.type(within(dialog).getByLabelText(/Current balance/), '12.345');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add the account' }),
    );
    expect(
      within(dialog).getByText('Use at most 2 decimals.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Current balance/)).toHaveFocus();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('refuses an amount with too many decimals before calling the API', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    await user.click(
      await screen.findByRole('button', { name: 'Add a transaction' }),
    );
    await user.type(await screen.findByLabelText('Amount'), '1.234');
    await user.type(screen.getByLabelText('Label'), 'Typo');
    await user.click(
      screen.getByRole('button', { name: 'Add the transaction' }),
    );
    expect(screen.getByText('Use at most 2 decimals.')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveFocus();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('formats with the server’s minor digits (HUF, IQD), not the browser’s', async () => {
    const huf: Account = {
      ...JOINT,
      id: '00000000-0000-7000-8000-0000000000b1',
      name: 'Forint account',
      currency: 'HUF',
      minor_digits: 2,
      iban: null,
      balance_minor: 150000,
    };
    const iqd: Account = {
      ...huf,
      id: '00000000-0000-7000-8000-0000000000b2',
      name: 'Dinar account',
      currency: 'IQD',
      minor_digits: 3,
      balance_minor: 1500,
    };
    installFakeApi(
      householdState({
        session: JANE.user.id,
        accounts: [huf, iqd],
        access: {
          [huf.id]: [{ user_id: JANE.user.id, permission: 'owner' }],
          [iqd.id]: [{ user_id: JANE.user.id, permission: 'owner' }],
        },
      }),
    );
    renderApp('/accounts');
    const plain = (text: string | null) =>
      (text ?? '').replace(/[\u00a0\u202f]/g, ' ');
    const row = (name: RegExp) =>
      screen.getByRole('link', { name }).closest('tr')!;
    await screen.findByRole('link', { name: /Forint account/ });
    expect(plain(row(/Forint account/).textContent)).toContain('HUF 1,500.00');
    expect(plain(row(/Dinar account/).textContent)).toContain('IQD 1.500');
  });

  it('shows the current balance as the hero, with the opening balance beside it', async () => {
    installFakeApi(
      householdState({
        session: JANE.user.id,
        accounts: [{ ...JOINT, balance_minor: 124035 }],
        access: {
          [JOINT.id]: [{ user_id: JANE.user.id, permission: 'owner' }],
        },
        transactions: sharedHousehold(JANE.user.id).transactions,
      }),
    );
    renderApp(`/accounts/${JOINT.id}`);
    const balance = await screen.findByRole('region', {
      name: 'Current balance',
    });
    expect(balance).toHaveTextContent('€1,197.45');
    expect(balance).toHaveTextContent('Opening balance €1,240.35');
  });

  it('never shows an empty hero when the balance is unknown', async () => {
    installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);
    expect(
      await screen.findByRole('heading', { name: 'Balance unknown' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Current balance' }),
    ).not.toBeInTheDocument();
  });

  it('shows the full IBAN, grouped, only in the account details', async () => {
    const user = userEvent.setup();
    installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    const more = await screen.findByRole('button', {
      name: `More actions for ${JOINT.name}`,
    });
    expect(screen.queryByText(/FR76/)).not.toBeInTheDocument();
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Account details' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Account details',
    });
    expect(
      within(dialog).getByText('FR76 0000 0000 0000 0000 0000 000'),
    ).toBeInTheDocument();
  });

  it('shows the latest transactions and loads more on demand', async () => {
    const user = userEvent.setup();
    const many: Transaction[] = Array.from({ length: 150 }, (_, i) => ({
      id: `00000000-0000-7000-8000-${String(1000 + i).padStart(12, '0')}`,
      account_id: JOINT.id,
      booking_date: '2026-10-28',
      value_date: null,
      amount_minor: -(i + 1),
      currency: 'EUR',
      minor_digits: 2,
      label: `Purchase ${i + 1}`,
      status: 'booked',
    }));
    const { requests } = installFakeApi(
      householdState({
        session: JANE.user.id,
        accounts: [JOINT],
        access: {
          [JOINT.id]: [{ user_id: JANE.user.id, permission: 'owner' }],
        },
        transactions: { [JOINT.id]: many },
      }),
    );
    renderApp(`/accounts/${JOINT.id}`);

    expect(await screen.findByText('Purchase 100')).toBeInTheDocument();
    expect(screen.queryByText('Purchase 101')).not.toBeInTheDocument();
    expect(
      screen.getByText('Showing the latest 100 transactions.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Purchase 150')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
    expect(
      requests
        .filter((r) => r.path.endsWith('/transactions'))
        .map((r) => r.query),
    ).toEqual(['limit=100', 'limit=200']);
  });

  it('lists accounts without a balance and masks the IBAN', async () => {
    installFakeApi(sharedHousehold(JANE.user.id));
    renderApp('/accounts');
    const row = (
      await screen.findByRole('link', { name: /Joint current account/ })
    ).closest('tr')!;
    expect(row).toHaveTextContent('Balance unknown');
    expect(row).toHaveTextContent('•••• 0000');
    expect(row).not.toHaveTextContent('FR76');
    expect(
      screen.getByRole('table', { name: '1 account' }),
    ).toBeInTheDocument();
  });
});

describe('overview', () => {
  it('totals each currency apart and counts what it leaves out', async () => {
    const usd: Account = {
      ...JOINT,
      id: '00000000-0000-7000-8000-0000000000c1',
      name: 'Travel card',
      kind: 'card',
      currency: 'USD',
      iban: null,
      balance_minor: 5000,
    };
    const savings: Account = {
      ...JOINT,
      id: '00000000-0000-7000-8000-0000000000c2',
      name: 'Savings book',
      kind: 'savings',
      iban: null,
      balance_minor: 100000,
    };
    const state = sharedHousehold(JANE.user.id);
    state.accounts = [
      { ...JOINT, balance_minor: 20000 },
      usd,
      savings,
      {
        ...savings,
        id: '00000000-0000-7000-8000-0000000000c3',
        name: 'Old',
        balance_minor: null,
      },
    ];
    for (const account of state.accounts.slice(1)) {
      state.access[account.id] = [
        { user_id: JANE.user.id, permission: 'owner' },
      ];
    }
    installFakeApi(state);
    renderApp('/');

    const summary = await screen.findByRole('region', {
      name: 'Total balance',
    });
    // EUR: 200.00 − 42.90 + 1,000.00; USD apart, never converted.
    expect(summary).toHaveTextContent('€1,157.10');
    expect(summary).toHaveTextContent('2 accounts');
    expect(summary).toHaveTextContent('$50.00');
    expect(summary).toHaveTextContent(
      '1 account without a known balance isn’t counted.',
    );
    expect(
      await screen.findByRole('table', { name: 'Latest transactions' }),
    ).toHaveTextContent('Groceries');
    // One add action on the screen: the dashed card.
    expect(
      screen.getAllByRole('button', { name: 'Add an account' }),
    ).toHaveLength(1);
  });
});

describe('sharing', () => {
  it('is hidden from people who do not own the account', async () => {
    installFakeApi(sharedHousehold(JOHN.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    await screen.findByRole('heading', { name: JOINT.name });
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Can view')).toBeInTheDocument();
    expect(
      screen.getByText(/View only: ask an owner for edit access/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add a transaction' }),
    ).not.toBeInTheDocument();
    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: `More actions for ${JOINT.name}` }),
      );
    expect(
      screen.queryByRole('menuitem', { name: 'Manage sharing' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Account details' }),
    ).toBeInTheDocument();
  });

  it('refuses the sharing screen to non-owners, without asking the API', async () => {
    const { requests } = installFakeApi(sharedHousehold(JOHN.user.id));
    renderApp(`/accounts/${JOINT.id}/sharing`);

    expect(
      await screen.findByText('Only owners manage sharing'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Give access' }),
    ).not.toBeInTheDocument();
    expect(requests.some((r) => r.path.includes('/access'))).toBe(false);
  });

  it('lets an owner change and revoke access with JSON requests', async () => {
    const user = userEvent.setup();
    const { requests, state } = installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    await user.click(
      await screen.findByRole('button', {
        name: `More actions for ${JOINT.name}`,
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Manage sharing' }));
    await screen.findByRole('heading', { name: 'Sharing' });
    expect(await screen.findByText('Jane Doe (you)')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Access for John Doe'),
      'write',
    );
    await waitFor(() =>
      expect(state.access[JOINT.id]).toContainEqual({
        user_id: JOHN.user.id,
        permission: 'write',
      }),
    );
    expect(requests.find((r) => r.method === 'PUT')).toMatchObject({
      contentType: 'application/json',
      body: { permission: 'write' },
    });

    const menu = screen.getByRole('button', {
      name: 'More actions for John Doe',
    });
    await user.click(menu);
    await user.click(screen.getByRole('menuitem', { name: 'Remove access' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Remove access',
    });
    expect(confirm).toHaveTextContent(
      'Remove John Doe’s access? They won’t see this account any more.',
    );
    // Focus starts on the safe choice.
    expect(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await user.click(
      within(confirm).getByRole('button', { name: 'Remove access' }),
    );
    const people = screen.getByRole('region', { name: 'People with access' });
    await waitFor(() =>
      expect(within(people).queryByText('John Doe')).not.toBeInTheDocument(),
    );
    expect(requests.find((r) => r.method === 'DELETE')).toMatchObject({
      path: `/accounts/${JOINT.id}/access/${JOHN.user.id}`,
      contentType: 'application/json',
    });
    // John can be given access again, from the dialog.
    await user.click(screen.getByRole('button', { name: 'Give access' }));
    const grant = await screen.findByRole('dialog', { name: 'Give access' });
    expect(
      within(grant).getByRole('option', { name: 'John Doe' }),
    ).toBeInTheDocument();
    await user.click(
      within(grant).getByRole('button', { name: 'Give access' }),
    );
    await waitFor(() =>
      expect(state.access[JOINT.id]).toContainEqual({
        user_id: JOHN.user.id,
        permission: 'read',
      }),
    );
  });
});

describe('invitations and tokens', () => {
  it('shows a new invitation link once, with the token in the fragment', async () => {
    const user = userEvent.setup();
    installFakeApi(householdState({ session: JANE.user.id }));
    renderApp('/invitations');

    await screen.findByRole('heading', { name: 'Invitations' });
    await user.click(
      await screen.findByRole('button', { name: 'Invite someone' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Admin' }));
    await user.click(
      screen.getByRole('button', { name: 'Create an invitation link' }),
    );

    const link = await screen.findByLabelText('Invitation link');
    expect((link as HTMLInputElement).value).toMatch(
      /#\/join\?token=fake-invitation-token$/,
    );
    expect(await screen.findByText('Admin invitation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Invitation link')).not.toBeInTheDocument();
    expect(screen.queryByText(/fake-invitation-token/)).not.toBeInTheDocument();
  });

  it('uses the new token when the invitation link changes in the tab', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({ inviteTokens: ['replacement-invitation-token'] }),
    );
    const { router } = renderApp('/join?token=old-invitation-token');
    await screen.findByRole('heading', { name: 'Join the household' });
    await router.navigate({
      to: '/join',
      search: { token: 'replacement-invitation-token' },
    });
    await user.type(screen.getByLabelText('Your name'), 'Alex Doe');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'a long enough password',
    );
    await user.click(
      screen.getByRole('button', { name: 'Join the household' }),
    );
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(
      requests.find((r) => r.path === '/invitations/accept'),
    ).toMatchObject({ body: { token: 'replacement-invitation-token' } });
  });

  it('accepts an invitation from the link', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({ inviteTokens: ['valid-invitation-token'] }),
    );
    renderApp('/join?token=valid-invitation-token');

    await screen.findByRole('heading', { name: 'Join the household' });
    expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Your name'), 'Alex Doe');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'a long enough password',
    );
    await user.click(
      screen.getByRole('button', { name: 'Join the household' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument();
    expect(
      requests.find((r) => r.path === '/invitations/accept'),
    ).toMatchObject({
      contentType: 'application/json',
      body: { token: 'valid-invitation-token', name: 'Alex Doe' },
    });
  });

  it('explains a used or expired invitation', async () => {
    const user = userEvent.setup();
    installFakeApi(householdState());
    renderApp('/join');

    await screen.findByRole('heading', { name: 'Join the household' });
    await user.type(screen.getByLabelText('Invitation code'), 'used-token');
    await user.type(screen.getByLabelText('Your name'), 'Alex Doe');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(
      screen.getByLabelText('Password'),
      'a long enough password',
    );
    await user.click(
      screen.getByRole('button', { name: 'Join the household' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation is invalid, expired or already used.',
    );
  });

  it('creates an API token shown once, then deletes it after confirmation', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({ session: JOHN.user.id }),
    );
    renderApp('/tokens');

    await screen.findByText('No API tokens yet');
    await user.click(screen.getByRole('button', { name: 'Create a token' }));
    await user.type(screen.getByLabelText('Token name'), 'Laptop');
    await user.selectOptions(screen.getByLabelText('Expires'), 'never');
    await user.click(screen.getByRole('button', { name: 'Create the token' }));

    expect(await screen.findByLabelText('API token')).toHaveValue(
      'fake-api-token-secret',
    );
    // The secret replaced the form: focus moves to it.
    expect(screen.getByLabelText('API token')).toHaveFocus();
    expect(
      requests.find((r) => r.path === '/tokens' && r.method === 'POST'),
    ).toMatchObject({ body: { name: 'Laptop', expires_in_days: null } });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      screen.queryByDisplayValue('fake-api-token-secret'),
    ).not.toBeInTheDocument();

    const row = (await screen.findByText('Laptop')).closest('tr')!;
    expect(row).toHaveTextContent('Never expires');
    await user.click(
      within(row).getByRole('button', { name: 'More actions for Laptop' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Delete the token' }),
    );
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(
      'Delete “Laptop”? Scripts using it stop working.',
    );
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete the token' }),
    );
    expect(await screen.findByText('No API tokens yet')).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'DELETE')).toMatchObject({
      contentType: 'application/json',
    });
  });
});

describe('dialogs and menus', () => {
  it('close on Escape and give focus back to what opened them', async () => {
    const user = userEvent.setup();
    installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    const open = await screen.findByRole('button', {
      name: 'Add a transaction',
    });
    await user.click(open);
    const dialog = await screen.findByRole('dialog', {
      name: 'Add a transaction',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      within(dialog).getByRole('radio', { name: 'Money out' }),
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();

    // The close button does the same.
    await user.click(open);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Close',
      }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('menus move with the arrow keys and close on Escape', async () => {
    const user = userEvent.setup();
    installFakeApi(sharedHousehold(JANE.user.id));
    renderApp(`/accounts/${JOINT.id}`);

    const button = await screen.findByRole('button', {
      name: `More actions for ${JOINT.name}`,
    });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('shows an unknown page inside the app when signed in', async () => {
    installFakeApi(householdState({ session: JANE.user.id }));
    renderApp('/no-such-page');
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Main' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the overview' }),
    ).toBeInTheDocument();
  });
});
