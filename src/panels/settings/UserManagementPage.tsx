import { useState } from 'react';
import type { FormEvent } from 'react';
import { useEntityQuery } from '../../hooks/useEntityQuery';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

interface UserRow {
  id: string;
  email: string | null;
  full_name: string;
  role: 'owner' | 'operator' | 'accountant' | 'viewer';
  is_active: boolean;
  company_id: number;
  // Bare-bones row; full row from PostgREST exposes many more columns.
}

const ROLE_OPTIONS: UserRow['role'][] = ['owner', 'operator', 'accountant', 'viewer'];

/**
 * User Management page — owner-only.
 *
 * Per TaskList TAXI-205:
 *   - Lists core.user_profiles rows for the current company (filter by
 *     company_id is enforced by the RLS policy from TAXI-110).
 *   - Invite form: email + role select — calls `public.admin_invite_user`
 *     RPC (server-side, SECURITY DEFINER).
 *   - Per-row role dropdown + is_active toggle — direct UPDATE through
 *     supabaseClient.from('user_profiles').update(...) (RLS gates writes).
 *
 * Wrapped at the route level in <RoleGuard allowedRoles={['owner']} />,
 * which adds the redirectTo="/unauthorized" behaviour for non-owners.
 */
export function UserManagementPage() {
  const { companyId } = useAuth();

  // useEntityQuery returns { list, create, ... }. For read we pull `list`,
  // for invite we use a separate `supabase.rpc()` call (the invite isn't
  // a regular CRUD row insert — it's a SECURITY DEFINER server function).
  const users = useEntityQuery('user_profiles').list().data as UserRow[] | undefined;

  // Invite form state.
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRow['role']>('operator');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const refreshAfterMutation = async () => {
    // useEntityQuery doesn't expose invalidate directly here (we'd need the
    // query client). For simplicity, full page reload — the typical pattern
    // after a server-side RPC. The useEntityQuery cache will refetch on
    // window focus anyway.
    window.location.reload();
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setInviteMessage(null);
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setInviteMessage({ tone: 'err', text: 'Enter a valid email.' });
      return;
    }
    setInviteBusy(true);
    const { data, error } = await supabase.rpc('admin_invite_user', {
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
    void refreshAfterMutation();
    void data; // user_id returned by the RPC; not displayed here in M2
    void companyId;
  };

  const updateRole = async (id: string, role: UserRow['role']) => {
    const { error } = await supabase.from('user_profiles').update({ role }).eq('id', id);
    if (error) {
      alert(`Role update failed: ${error.message}`);
    } else {
      void refreshAfterMutation();
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_active: !currentActive })
      .eq('id', id);
    if (error) {
      alert(`Toggle failed: ${error.message}`);
    } else {
      void refreshAfterMutation();
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
        {!users ? (
          <div className="loading">Loading users…</div>
        ) : users.length === 0 ? (
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
