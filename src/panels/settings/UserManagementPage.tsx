import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

interface UserRow {
  id: string;
  email: string | null;
  full_name: string;
  role: 'owner' | 'operator' | 'accountant' | 'viewer';
  is_active: boolean;
  company_id: number;
}

const ROLE_OPTIONS: UserRow['role'][] = ['owner', 'operator', 'accountant', 'viewer'];

/**
 * User Management page — owner-only.
 *
 * PostgREST-on-custom-schemas workaround: PostgREST 16.2 in this Supabase
 * CLI build refuses to expose `core` / `master` / etc. via `db.schemas` in
 * config.toml, so the SPA cannot do `supabase.from('core.user_profiles')`.
 * Until that's resolved (M14 hardening ticket), every read and update
 * goes through dedicated RPCs:
 *   - list_users_for_company()  → reads profiles for caller's company
 *   - update_user_state(...)    → updates role + is_active for one user
 *   - admin_invite_user(...)    → creates a new auth.users + profile
 */
export function UserManagementPage() {
  const { companyId } = useAuth();
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ['rpc', 'list_users_for_company', companyId ?? 'none'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_users_for_company');
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });
  const users = usersQuery.data;

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRow['role']>('operator');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const refreshList = async () => {
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_users_for_company'] });
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviteMessage(null);
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteMessage({ tone: 'err', text: 'Enter a valid email.' });
      return;
    }
    setInviteBusy(true);
    const { error } = await supabase.rpc('admin_invite_user', {
      p_email: inviteEmail,
      p_role: inviteRole,
    });
    setInviteBusy(false);
    if (error) {
      setInviteMessage({ tone: 'err', text: error.message });
      return;
    }
    setInviteMessage({
      tone: 'ok',
      text: `Invited ${inviteEmail} as ${inviteRole}. Check Mailpit (port 54324) for the invite email.`,
    });
    setInviteEmail('');
    setInviteRole('operator');
    void refreshList();
    void companyId;
  };

  const updateRole = async (id: string, role: UserRow['role']) => {
    const { error } = await supabase.rpc('update_user_state', {
      p_user_id: id,
      p_role: role,
      p_is_active: null,
    });
    if (error) {
      alert(`Role update failed: ${error.message}`);
    } else {
      void refreshList();
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase.rpc('update_user_state', {
      p_user_id: id,
      p_role: null,
      p_is_active: !currentActive,
    });
    if (error) {
      alert(`Toggle failed: ${error.message}`);
    } else {
      void refreshList();
    }
  };

  return (
    <main className="app-main">
      <h1 className="page-title">
        User Management <span className="page-title__accent">— Settings</span>
      </h1>
      <p className="page-subtitle">
        Invite operators, accountants, and viewers. Owner role is the highest
        — keep it to a small, trusted group.
      </p>

      <section className="card card--accent" style={{ marginBottom: '1.5rem' }}>
        <h3>Invite user</h3>
        <form onSubmit={handleInvite} className="auth-form" noValidate>
          <div className="form-field">
            <label htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              autoComplete="off"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="newuser@example.com"
            />
          </div>
          <div className="form-field">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRow['role'])}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          {inviteMessage && (
            <div
              className={
                inviteMessage.tone === 'ok'
                  ? 'form-message form-message--ok'
                  : 'form-error form-error--server'
              }
              role="status"
            >
              {inviteMessage.text}
            </div>
          )}
          <button type="submit" className="btn btn--primary" disabled={inviteBusy}>
            {inviteBusy ? (
              <>
                <span className="loading__spinner" aria-hidden="true" />
                Inviting…
              </>
            ) : (
              'Invite User'
            )}
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Users in your company</h3>
        {usersQuery.isLoading ? (
          <div className="loading" data-testid="users-loading">
            <span className="loading__spinner" aria-hidden="true" />
            Loading users…
          </div>
        ) : usersQuery.isError ? (
          <div className="form-error form-error--server" role="alert">
            Failed to load users:{' '}
            {usersQuery.error instanceof Error ? usersQuery.error.message : 'unknown error'}
          </div>
        ) : !users || users.length === 0 ? (
          <p>No users visible for your company yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Full name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'data-table__row--inactive'}>
                  <td>{u.full_name || '—'}</td>
                  <td>{u.email || '—'}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateRole(u.id, e.target.value as UserRow['role'])
                      }
                      aria-label={`Role for ${u.email ?? u.id}`}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{u.is_active ? 'yes' : 'no'}</td>
                  <td>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => toggleActive(u.id, u.is_active)}
                    >
                      {u.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
