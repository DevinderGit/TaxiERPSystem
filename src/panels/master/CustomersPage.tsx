import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { CustomerFormModal } from './CustomerFormModal';
import type { CustomerRow } from './CustomerFormModal';

/**
 * CustomersPage — read list with filters + Add/Edit/Delete flows.
 *
 * Same RPC pattern as the rest of M2/M3/M4/M5: reads via
 * `list_customers_for_company`, writes via `add_customer` /
 * `update_customer` / `delete_customer`. PostgREST custom-schema workaround.
 *
 * Filtering is client-side over the already-fetched list.
 *
 * Role gating: accountant + viewer see the list with no action buttons;
 * owner + operator see Add / Edit / Delete (the form modal does its own
 * validation and the delete RPC checks for FK references).
 */

export function CustomersPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [filterSearch, setFilterSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as CustomerRow[];
    },
  });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const search = filterSearch.trim().toUpperCase();
    return rows.filter((c) => {
      if (filterType !== 'all' && c.client_type !== filterType) return false;
      if (filterActive === 'active' && !c.is_active) return false;
      if (filterActive === 'inactive' && c.is_active) return false;
      if (search) {
        const haystack = `${c.name} ${c.phone} ${c.gstin ?? ''}`.toUpperCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [query.data, filterSearch, filterType, filterActive]);

  const openAdd = () => {
    setEditing(null);
    setModalMode('add');
  };
  const openEdit = (c: CustomerRow) => {
    setEditing(c);
    setModalMode('edit');
  };
  const closeModal = () => {
    if (busy) return;
    setModalMode(null);
    setEditing(null);
  };

  const handleDelete = async (c: CustomerRow) => {
    if (!window.confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
    const { error: rpcErr } = await supabase.rpc('delete_customer', { p_id: c.id });
    if (rpcErr) { window.alert(rpcErr.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_customers_for_company'] });
  };

  const handleToggleActive = async (c: CustomerRow) => {
    const next = !c.is_active;
    const { error: rpcErr } = await supabase.rpc('update_customer', {
      p_id: c.id,
      p_is_active: next,
    });
    if (rpcErr) {
      window.alert(rpcErr.message);
      return;
    }
    setActionNotice(`${c.name} ${next ? 'reactivated' : 'deactivated'}.`);
    setTimeout(() => setActionNotice(null), 1800);
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_customers_for_company'] });
  };

  return (
    <main className="app-main">
      <Link to="/master" className="back-link">← Back to Master</Link>
      <h1 className="page-title">
        Customers <span className="page-title__accent">— Master</span>
      </h1>
      <p className="page-subtitle">
        B2B and personal clients. State drives inter/intra-state GST
        calculations on every bill (M7).
      </p>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Customer list</h3>
          {canEdit && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={openAdd}
            >
              Add Customer
            </button>
          )}
        </div>
        <p style={{ marginTop: 0 }}>
          Search by name, phone, or GSTIN. Filter by client type and status.
        </p>

        {actionNotice && (
          <div
            className="form-message form-message--ok"
            role="status"
            data-testid="action-notice"
            style={{ marginBottom: '0.75rem' }}
          >
            {actionNotice}
          </div>
        )}

        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="form-field" style={{ minWidth: '180px' }}>
            <label htmlFor="filter-search">Search</label>
            <input
              id="filter-search"
              type="search"
              placeholder="name, phone, or GSTIN"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ minWidth: '150px' }}>
            <label htmlFor="filter-type">Client type</label>
            <select id="filter-type" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All</option>
              <option value="company">Company</option>
              <option value="personal">Personal</option>
            </select>
          </div>
          <div className="form-field" style={{ minWidth: '140px' }}>
            <label htmlFor="filter-active">Status</label>
            <select id="filter-active" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {query.isLoading ? (
          <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading customers…</div>
        ) : query.isError ? (
          <div className="form-error form-error--server" role="alert">
            Failed to load: {query.error instanceof Error ? query.error.message : 'unknown error'}
          </div>
        ) : !filtered.length ? (
          <p>{(query.data ?? []).length === 0 ? 'No customers yet.' : 'No customers match the current filters.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company name</th>
                  <th>Type</th>
                  <th>GSTIN</th>
                  <th>State</th>
                  <th>Phone</th>
                  <th>Active</th>
                  {canEdit && <th style={{ width: '160px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className={c.is_active ? '' : 'data-table__row--inactive'} data-testid={`customer-row-${c.id}`}>
                    <td>{c.name}</td>
                    <td>{c.company_name ?? '—'}</td>
                    <td>{c.client_type}</td>
                    <td>{c.gstin ?? '—'}</td>
                    <td>{c.state}</td>
                    <td>{c.phone}</td>
                    <td>{c.is_active ? 'yes' : 'no'}</td>
                    {canEdit && (
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => openEdit(c)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleToggleActive(c)}
                            data-testid={`toggle-${c.id}`}
                          >
                            {c.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void handleDelete(c)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalMode && (
        <CustomerFormModal
          mode={modalMode}
          initial={editing}
          busy={busy}
          onBusyChange={setBusy}
          onClose={closeModal}
          onSaved={() => { setModalMode(null); setEditing(null); }}
        />
      )}
    </main>
  );
}
