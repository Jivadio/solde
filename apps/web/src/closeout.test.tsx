// SPDX-License-Identifier: AGPL-3.0-or-later
// Flows closing Milestone 2: editing an account, setting a missing
// balance, revoking an invitation, and the plain-HTTP cookie warning.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Account, Invitation } from './api/client';
import { JANE, JOHN, householdState, installFakeApi } from './test/fakeApi';
import { renderApp } from './test/render';

const ACCOUNT: Account = {
  id: '00000000-0000-7000-8000-0000000000b1',
  name: 'Joint current account',
  kind: 'checking',
  currency: 'EUR',
  minor_digits: 2,
  iban: 'FR76 0000 0000 0000 0000 0000 000',
  balance_minor: null,
  permission: 'owner',
};

function household(
  session: string,
  balance: number | null,
  john: 'read' | 'write' = 'read',
) {
  return householdState({
    session,
    accounts: [{ ...ACCOUNT, balance_minor: balance }],
    access: {
      [ACCOUNT.id]: [
        { user_id: JANE.user.id, permission: 'owner' },
        { user_id: JOHN.user.id, permission: john },
      ],
    },
    transactions: {
      [ACCOUNT.id]: [
        {
          id: '00000000-0000-7000-8000-0000000000c1',
          account_id: ACCOUNT.id,
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

async function openMenuItem(name: string) {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', {
      name: `More actions for ${ACCOUNT.name}`,
    }),
  );
  await user.click(screen.getByRole('menuitem', { name }));
  return user;
}

describe('editing an account', () => {
  it('renames it and changes its opening balance; the current balance follows', async () => {
    const { requests } = installFakeApi(household(JANE.user.id, 10_000));
    renderApp(`/accounts/${ACCOUNT.id}`);
    const user = await openMenuItem('Edit account');

    const dialog = await screen.findByRole('dialog', { name: 'Edit account' });
    const name = within(dialog).getByLabelText('Account name');
    expect(name).toHaveFocus();
    expect(name).toHaveValue(ACCOUNT.name);
    const balance = within(dialog).getByLabelText(/Opening balance/);
    expect(balance).toHaveValue('100.00');
    await user.clear(name);
    await user.type(name, 'Household account');
    await user.clear(balance);
    await user.type(balance, '1,240.35');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the changes' }),
    );

    await screen.findByRole('heading', {
      name: 'Household account',
      level: 1,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Account updated.',
    );
    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch).toMatchObject({
      path: `/accounts/${ACCOUNT.id}`,
      contentType: 'application/json',
      body: { name: 'Household account', balance_minor: 124035 },
    });
    expect(
      screen.getByRole('region', { name: 'Current balance' }),
    ).toHaveTextContent('€1,197.45');
  });

  it('sends only what changed, and clears the balance when emptied', async () => {
    const { requests } = installFakeApi(household(JANE.user.id, 124035));
    renderApp(`/accounts/${ACCOUNT.id}`);
    const user = await openMenuItem('Edit account');
    const dialog = await screen.findByRole('dialog', { name: 'Edit account' });
    await user.clear(within(dialog).getByLabelText(/Opening balance/));
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the changes' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Balance unknown' }),
    ).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      balance_minor: null,
    });
  });

  it('never sends a field the person left alone, even after a refetch', async () => {
    const { state, requests } = installFakeApi(household(JANE.user.id, 10_000));
    const { queryClient } = renderApp(`/accounts/${ACCOUNT.id}`);
    const user = await openMenuItem('Edit account');
    const dialog = await screen.findByRole('dialog', { name: 'Edit account' });

    // Someone else changes the balance while the dialog is open.
    state.accounts[0]!.balance_minor = 20_000;
    await act(() =>
      queryClient.refetchQueries({ queryKey: ['accounts', ACCOUNT.id] }),
    );
    const name = within(dialog).getByLabelText('Account name');
    await user.clear(name);
    await user.type(name, 'Household account');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the changes' }),
    );

    await waitFor(() =>
      expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        name: 'Household account',
      }),
    );
    expect(state.accounts[0]!.balance_minor).toBe(20_000);
  });

  it('closes without a request when nothing changed', async () => {
    const { requests } = installFakeApi(household(JANE.user.id, 10_000));
    renderApp(`/accounts/${ACCOUNT.id}`);
    const user = await openMenuItem('Edit account');
    const dialog = await screen.findByRole('dialog', { name: 'Edit account' });
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the changes' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('keeps errors inside the dialog', async () => {
    const { requests } = installFakeApi(household(JANE.user.id, 10_000));
    renderApp(`/accounts/${ACCOUNT.id}`);
    const user = await openMenuItem('Edit account');
    const dialog = await screen.findByRole('dialog', { name: 'Edit account' });
    await user.clear(within(dialog).getByLabelText('Account name'));
    await user.clear(within(dialog).getByLabelText(/Opening balance/));
    await user.type(within(dialog).getByLabelText(/Opening balance/), '12x');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the changes' }),
    );
    expect(
      within(dialog).getByText('Enter a name for the account.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Enter digits only, with a decimal point or comma if needed.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Account name')).toHaveFocus();
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });

  it('lets the owner set the balance of an account added without one', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(household(JANE.user.id, null));
    renderApp(`/accounts/${ACCOUNT.id}`);

    const unknown = (
      await screen.findByRole('heading', { name: 'Balance unknown' })
    ).closest('section')!;
    await user.click(
      within(unknown).getByRole('button', { name: 'Set the balance' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Set the balance',
    });
    expect(dialog).toHaveAccessibleDescription(
      /Enter what Joint current account held before the transactions/,
    );
    // Only the balance, and it is required here.
    expect(
      within(dialog).queryByLabelText('Account name'),
    ).not.toBeInTheDocument();
    const field = within(dialog).getByLabelText('Opening balance');
    expect(field).toHaveFocus();
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the balance' }),
    );
    expect(
      within(dialog).getByText('Enter the opening balance.'),
    ).toBeInTheDocument();
    await user.type(field, '−12.5');
    await user.click(
      within(dialog).getByRole('button', { name: 'Save the balance' }),
    );

    const balance = await screen.findByRole('region', {
      name: 'Current balance',
    });
    expect(balance).toHaveTextContent('−€55.40');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Balance saved.',
    );
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      balance_minor: -1250,
    });
  });

  it('offers neither editing nor setting the balance to non-owners', async () => {
    const user = userEvent.setup();
    installFakeApi(household(JOHN.user.id, null, 'write'));
    renderApp(`/accounts/${ACCOUNT.id}`);

    const unknown = (
      await screen.findByRole('heading', { name: 'Balance unknown' })
    ).closest('section')!;
    expect(within(unknown).queryByRole('button')).not.toBeInTheDocument();
    expect(unknown).toHaveTextContent(
      'An owner of the account can set its balance.',
    );
    await user.click(
      screen.getByRole('button', {
        name: `More actions for ${ACCOUNT.name}`,
      }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'Edit account' }),
    ).not.toBeInTheDocument();
  });
});

const PENDING: Invitation = {
  id: '00000000-0000-7000-8000-0000000000d1',
  role: 'member',
  created_by: JANE.user.id,
  created_at: '2026-11-10T10:00:00.000000Z',
  expires_at: '2099-11-17T10:00:00.000000Z',
  accepted_at: null,
  accepted_by: null,
};

const ACCEPTED: Invitation = {
  ...PENDING,
  id: '00000000-0000-7000-8000-0000000000d2',
  accepted_at: '2026-11-11T10:00:00.000000Z',
  accepted_by: JOHN.user.id,
};

describe('revoking an invitation', () => {
  it('asks first, then revokes it with a JSON request', async () => {
    const user = userEvent.setup();
    const { requests } = installFakeApi(
      householdState({
        session: JANE.user.id,
        invitations: [PENDING, ACCEPTED],
      }),
    );
    renderApp('/invitations');

    const rows = await screen.findAllByRole('row');
    const accepted = rows.find((row) =>
      row.textContent?.includes('Accepted by John Doe'),
    )!;
    expect(within(accepted).queryByRole('button')).not.toBeInTheDocument();
    const pending = rows.find((row) => row.textContent?.includes('Waiting'))!;
    await user.click(
      within(pending).getByRole('button', {
        name: 'More actions for the invitation that expires Nov 17, 2099',
      }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Revoke the invitation' }),
    );
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Revoke this invitation?',
    });
    expect(confirm).toHaveTextContent('The link stops working right away');
    // The safe action has focus.
    expect(
      within(confirm).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus();
    await user.click(
      within(confirm).getByRole('button', { name: 'Revoke the invitation' }),
    );

    await waitFor(() =>
      expect(screen.queryByText('Waiting')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Invitation revoked.',
    );
    expect(requests.find((r) => r.method === 'DELETE')).toMatchObject({
      path: `/invitations/${PENDING.id}`,
      contentType: 'application/json',
    });
    expect(screen.getByText('Accepted by John Doe')).toBeInTheDocument();
    // The row and its menu button are gone: focus stays in the content.
    await waitFor(() => expect(document.getElementById('main')).toHaveFocus());
  });

  it('explains, in the dialog, an invitation used in the meantime', async () => {
    const user = userEvent.setup();
    const { state } = installFakeApi(
      householdState({ session: JANE.user.id, invitations: [PENDING] }),
    );
    renderApp('/invitations');
    await user.click(
      await screen.findByRole('button', {
        name: /More actions for the invitation/,
      }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Revoke the invitation' }),
    );
    const confirm = await screen.findByRole('alertdialog');
    state.invitations = [{ ...PENDING, accepted_at: ACCEPTED.accepted_at }];
    await user.click(
      within(confirm).getByRole('button', { name: 'Revoke the invitation' }),
    );
    expect(
      await within(confirm).findByText(
        'This invitation was already used. The member who joined with it stays in the household.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the plain-HTTP cookie warning', () => {
  it('tells admins which setting it is and where the guide is', async () => {
    installFakeApi(
      householdState({ session: JANE.user.id, insecureCookies: true }),
    );
    renderApp('/');
    const title = await screen.findByText('Your sign-in travels unencrypted');
    const notice = title.closest('.sd-notice')!;
    expect(notice).toHaveTextContent(
      'With SOLDE_INSECURE_COOKIES=1, browsers send the sign-in cookie over plain HTTP',
    );
    // Calm: a warning, not an alert, and nothing to dismiss it with.
    expect(notice).not.toHaveAttribute('role', 'alert');
    expect(within(notice as HTMLElement).queryByRole('button')).toBeNull();
    const guide = within(notice as HTMLElement).getByRole('link', {
      name: 'Read the self-hosting guide',
    });
    expect(guide).toHaveAttribute(
      'href',
      expect.stringContaining('docs/self-hosting.md'),
    );
    expect(guide).toHaveAttribute('rel', 'noreferrer');
  });

  it('tells members to ask their admin, on every screen', async () => {
    installFakeApi(
      householdState({ session: JOHN.user.id, insecureCookies: true }),
    );
    renderApp('/tokens');
    const title = await screen.findByText('Your sign-in travels unencrypted');
    const notice = title.closest('.sd-notice')!;
    expect(notice).toHaveTextContent('ask your admin about HTTPS');
    expect(notice).not.toHaveTextContent('SOLDE_INSECURE_COOKIES');
  });

  it('stays away when cookies are secure', async () => {
    installFakeApi(householdState({ session: JANE.user.id }));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Overview', level: 1 });
    expect(
      screen.queryByText('Your sign-in travels unencrypted'),
    ).not.toBeInTheDocument();
  });
});
