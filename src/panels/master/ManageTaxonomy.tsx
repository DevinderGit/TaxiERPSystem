import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

/**
 * Manage Taxonomy — Vehicle Groups + Vehicle Types CRUD.
 *
 * Two side-by-side cards inside the Manage Vehicles tab. Same RPC pattern
 * as TAXI-301/302: reads via `list_*_for_company()`, writes via dedicated
 * `add_*` / `update_*` / `delete_*` RPCs (PostgREST custom-schema workaround).
 *
 * Role gating (per TAXI-303 pattern): owner + operator see Add / Edit /
 * Delete buttons; accountant + viewer see read-only lists.
 *
 * Delete is blocked at the RPC level if any master.vehicles row references
 * the group/type — the RPC returns a friendly count-based message that
 * the page surfaces via alert().
 */

interface VehicleGroup {
  id: number;
  name: string;
  display_order: number | null;
}

interface VehicleType {
  id: number;
  name: string;
}

export function ManageTaxonomy() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: '1.5rem',
      }}
    >
      <VehicleGroupsCard />
      <VehicleTypesCard />
    </div>
  );
}

// -- Vehicle Groups --------------------------------------------------------

function VehicleGroupsCard() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['rpc', 'list_vehicle_groups_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_groups_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleGroup[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['rpc', 'list_vehicle_groups_for_company'] });

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const orderRaw = String(fd.get('display_order') ?? '').trim();
    const display_order = orderRaw === '' ? null : Number(orderRaw);
    if (!name) return;
    if (display_order != null && Number.isNaN(display_order)) {
      setError('Display order must be a number');
      return;
    }
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('add_vehicle_group', { p_name: name, p_display_order: display_order });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setAddOpen(false);
    await invalidate();
  };

  const handleEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editId == null) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    const orderRaw = String(fd.get('display_order') ?? '').trim();
    const display_order = orderRaw === '' ? null : Number(orderRaw);
    if (!name) return;
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('update_vehicle_group', {
      p_id: editId,
      p_name: name,
      p_display_order: display_order,
    });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setEditId(null);
    await invalidate();
  };

  const handleDelete = async (row: VehicleGroup) => {
    if (!window.confirm(`Delete group "${row.name}"?`)) return;
    setError(null);
    const { error: rpcErr } = await supabase.rpc('delete_vehicle_group', { p_id: row.id });
    if (rpcErr) {
      window.alert(rpcErr.message);
      return;
    }
    await invalidate();
  };

  return (
    <section className="card card--accent" data-testid="groups-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Vehicle Groups</h3>
        {canEdit && !addOpen && (
          <button type="button" className="btn" onClick={() => { setAddOpen(true); setError(null); }}>
            Add Group
          </button>
        )}
      </div>
      <p style={{ marginTop: 0 }}>Group vehicles into Sedan, SUV, Tempo, etc.</p>

      {addOpen && (
        <form
          onSubmit={handleAdd}
          className="auth-form"
          noValidate
          style={{ background: 'var(--color-surface-2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}
        >
          <div className="form-field">
            <label htmlFor="group-name">Name *</label>
            <input id="group-name" name="name" type="text" autoComplete="off" required />
          </div>
          <div className="form-field">
            <label htmlFor="group-order">Display order</label>
            <input id="group-order" name="display_order" type="number" inputMode="numeric" placeholder="e.g. 1" />
          </div>
          {error && <div className="form-error form-error--server" role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <><span className="loading__spinner" aria-hidden="true" />Saving…</> : 'Save'}
            </button>
            <button type="button" className="btn" onClick={() => { setAddOpen(false); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {query.isLoading ? (
        <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading groups…</div>
      ) : query.isError ? (
        <div className="form-error form-error--server" role="alert">
          Failed to load: {query.error instanceof Error ? query.error.message : 'unknown error'}
        </div>
      ) : !query.data || query.data.length === 0 ? (
        <p>No groups yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: '90px' }}>Order</th>
              {canEdit && <th style={{ width: '160px' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {query.data.map((g) =>
              editId === g.id ? (
                <tr key={g.id}>
                  <td colSpan={canEdit ? 3 : 2}>
                    <form onSubmit={handleEdit} className="auth-form" noValidate style={{ gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div className="form-field" style={{ flex: 1 }}>
                          <label htmlFor={`edit-group-name-${g.id}`} style={{ display: 'none' }}>Name</label>
                          <input id={`edit-group-name-${g.id}`} name="name" type="text" defaultValue={g.name} required />
                        </div>
                        <div className="form-field" style={{ width: '90px' }}>
                          <label htmlFor={`edit-group-order-${g.id}`} style={{ display: 'none' }}>Order</label>
                          <input id={`edit-group-order-${g.id}`} name="display_order" type="number" defaultValue={g.display_order ?? ''} />
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={busy}>
                          {busy ? '…' : 'Save'}
                        </button>
                        <button type="button" className="btn" onClick={() => { setEditId(null); setError(null); }} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                      {error && <div className="form-error form-error--server" role="alert">{error}</div>}
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={g.id} data-testid={`group-row-${g.id}`}>
                  <td>{g.name}</td>
                  <td>{g.display_order ?? '—'}</td>
                  {canEdit && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button type="button" className="btn" onClick={() => { setEditId(g.id); setError(null); }}>
                          Edit
                        </button>
                        <button type="button" className="btn" onClick={() => void handleDelete(g)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

// -- Vehicle Types ---------------------------------------------------------

function VehicleTypesCard() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['rpc', 'list_vehicle_types_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_types_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleType[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['rpc', 'list_vehicle_types_for_company'] });

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('add_vehicle_type', { p_name: name });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setAddOpen(false);
    await invalidate();
  };

  const handleEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editId == null) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('update_vehicle_type', { p_id: editId, p_name: name });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setEditId(null);
    await invalidate();
  };

  const handleDelete = async (row: VehicleType) => {
    if (!window.confirm(`Delete type "${row.name}"?`)) return;
    setError(null);
    const { error: rpcErr } = await supabase.rpc('delete_vehicle_type', { p_id: row.id });
    if (rpcErr) {
      window.alert(rpcErr.message);
      return;
    }
    await invalidate();
  };

  return (
    <section className="card card--accent" data-testid="types-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Vehicle Types</h3>
        {canEdit && !addOpen && (
          <button type="button" className="btn" onClick={() => { setAddOpen(true); setError(null); }}>
            Add Type
          </button>
        )}
      </div>
      <p style={{ marginTop: 0 }}>Categorise vehicles within a group: AC, Non-AC, Electric, etc.</p>

      {addOpen && (
        <form
          onSubmit={handleAdd}
          className="auth-form"
          noValidate
          style={{ background: 'var(--color-surface-2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}
        >
          <div className="form-field">
            <label htmlFor="type-name">Name *</label>
            <input id="type-name" name="name" type="text" autoComplete="off" required />
          </div>
          {error && <div className="form-error form-error--server" role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <><span className="loading__spinner" aria-hidden="true" />Saving…</> : 'Save'}
            </button>
            <button type="button" className="btn" onClick={() => { setAddOpen(false); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {query.isLoading ? (
        <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading types…</div>
      ) : query.isError ? (
        <div className="form-error form-error--server" role="alert">
          Failed to load: {query.error instanceof Error ? query.error.message : 'unknown error'}
        </div>
      ) : !query.data || query.data.length === 0 ? (
        <p>No types yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              {canEdit && <th style={{ width: '160px' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {query.data.map((t) =>
              editId === t.id ? (
                <tr key={t.id}>
                  <td colSpan={canEdit ? 2 : 1}>
                    <form onSubmit={handleEdit} className="auth-form" noValidate style={{ gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                        <div className="form-field" style={{ flex: 1 }}>
                          <label htmlFor={`edit-type-name-${t.id}`} style={{ display: 'none' }}>Name</label>
                          <input id={`edit-type-name-${t.id}`} name="name" type="text" defaultValue={t.name} required />
                        </div>
                        <button type="submit" className="btn btn--primary" disabled={busy}>
                          {busy ? '…' : 'Save'}
                        </button>
                        <button type="button" className="btn" onClick={() => { setEditId(null); setError(null); }} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                      {error && <div className="form-error form-error--server" role="alert">{error}</div>}
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={t.id} data-testid={`type-row-${t.id}`}>
                  <td>{t.name}</td>
                  {canEdit && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button type="button" className="btn" onClick={() => { setEditId(t.id); setError(null); }}>
                          Edit
                        </button>
                        <button type="button" className="btn" onClick={() => void handleDelete(t)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
