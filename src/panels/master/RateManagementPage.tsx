import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { RateFormModal } from './RateFormModal';

/**
 * RateManagementPage — page shell + customer picker (TAXI-601) +
 * rate matrix CRUD + inline cell edit with time-travel (TAXI-602).
 *
 * UX per MTP TAXI-602:
 * - "Add Rate" button → modal form (vehicle_group, vehicle_type, duty_type,
 *   rate fields, effective_from). Flexible duty type hides the rate fields.
 * - Inline cell edit on the current (effective_to IS NULL) row: click a
 *   numeric cell → becomes an input → press Enter (or blur) → confirm
 *   dialog "Changing a rate creates a new effective row. The old rate will
 *   be closed. Continue?" → on Yes, calls update_rate_with_time_travel.
 * - Closed rows (effective_to IS NOT NULL) are read-only — the cell is
 *   not editable.
 *
 * Role gating: canEdit (owner + operator) controls Add Rate button +
 * cell editing. Accountant + viewer see the matrix read-only.
 */

interface CustomerRow {
  id: number;
  name: string;
  company_name: string | null;
  client_type: 'company' | 'personal';
  is_active: boolean;
}

interface VehicleGroup { id: number; name: string; display_order: number | null }
interface VehicleType  { id: number; name: string }

interface RateRow {
  id: number;
  vehicle_group_id: number | null;
  vehicle_group_name: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  duty_type: string;
  base_rate: number | null;
  per_km_rate: number | null;
  per_hour_rate: number | null;
  per_day_rate: number | null;
  extra_hour_rate: number | null;
  extra_km_rate: number | null;
  night_halt_rate: number | null;
  driver_allowance: number | null;
  min_charge: number | null;
  effective_from: string;
  effective_to: string | null;
}

type RateField =
  | 'base_rate' | 'per_km_rate' | 'per_hour_rate' | 'per_day_rate'
  | 'extra_hour_rate' | 'extra_km_rate' | 'night_halt_rate'
  | 'driver_allowance' | 'min_charge';

const FIELD_HEADERS: { key: RateField; label: string }[] = [
  { key: 'base_rate',        label: 'Base' },
  { key: 'per_km_rate',      label: '/km' },
  { key: 'per_hour_rate',    label: '/hr' },
  { key: 'per_day_rate',     label: '/day' },
  { key: 'extra_hour_rate',  label: 'Extra /hr' },
  { key: 'extra_km_rate',    label: 'Extra /km' },
  { key: 'night_halt_rate',  label: 'Night halt' },
  { key: 'driver_allowance', label: 'Driver' },
  { key: 'min_charge',       label: 'Min charge' },
];

export function RateManagementPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [filterGroupId, setFilterGroupId] = useState<string>('all');
  const [filterTypeId, setFilterTypeId] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  // Inline-edit state: which (row, field) is currently an <input>.
  const [editingCell, setEditingCell] = useState<{ rowId: number; field: RateField } | null>(null);
  const [cellDraft, setCellDraft] = useState<string>('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as CustomerRow[];
    },
  });

  const groupsQuery = useQuery({
    queryKey: ['rpc', 'list_vehicle_groups_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_groups_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleGroup[];
    },
  });
  const typesQuery = useQuery({
    queryKey: ['rpc', 'list_vehicle_types_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_types_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleType[];
    },
  });

  const ratesQuery = useQuery({
    queryKey: ['rpc', 'list_rates_for_customer', selectedCustomerId === '' ? 'none' : selectedCustomerId],
    enabled: selectedCustomerId !== '',
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_rates_for_customer', { p_customer_id: selectedCustomerId });
      if (e) throw e;
      return (data ?? []) as RateRow[];
    },
  });

  const activeCustomers = (customersQuery.data ?? []).filter((c) => c.is_active);

  const filteredRates = useMemo(() => {
    const rows = ratesQuery.data ?? [];
    return rows.filter((r) => {
      if (filterGroupId !== 'all' && String(r.vehicle_group_id ?? '') !== filterGroupId) return false;
      if (filterTypeId !== 'all' && String(r.vehicle_type_id ?? '') !== filterTypeId) return false;
      return true;
    });
  }, [ratesQuery.data, filterGroupId, filterTypeId]);

  const beginCellEdit = (rowId: number, field: RateField, currentValue: number | null) => {
    if (!canEdit) return;
    setCellError(null);
    setEditingCell({ rowId, field });
    setCellDraft(currentValue == null ? '' : String(currentValue));
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setCellDraft('');
  };

  const handleDelete = async (row: RateRow) => {
    if (!window.confirm(`Delete this rate (${row.duty_type})? This cannot be undone.`)) return;
    const { error: rpcErr } = await supabase.rpc('delete_rate', { p_id: row.id });
    if (rpcErr) { window.alert(rpcErr.message); return; }
    setActionNotice('Rate deleted.');
    setTimeout(() => setActionNotice(null), 2000);
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_rates_for_customer'] });
  };

  const commitCellEdit = async (row: RateRow, field: RateField) => {
    const oldValue = row[field];
    const newRaw = cellDraft.trim();
    const newValue = newRaw === '' ? null : Number(newRaw);
    if (newValue != null && Number.isNaN(newValue)) {
      setCellError('Value must be a number.');
      return;
    }
    if (newValue === oldValue) {
      cancelCellEdit();
      return;
    }
    // Per operator directive (M6 follow-up): no more time-travel. The new
    // `update_rate` RPC does an in-place UPDATE — no confirm dialog needed.
    const payload: Record<string, number | null> = {};
    payload[`p_${field}`] = newValue;
    const { error: rpcErr } = await supabase.rpc('update_rate', {
      p_id: row.id,
      ...payload,
    });
    if (rpcErr) {
      setCellError(rpcErr.message);
      return;
    }
    setActionNotice('Rate updated.');
    setTimeout(() => setActionNotice(null), 2000);
    cancelCellEdit();
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_rates_for_customer'] });
  };

  const onCellKey = (e: KeyboardEvent<HTMLInputElement>, row: RateRow, field: RateField) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitCellEdit(row, field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCellEdit();
    }
  };

  return (
    <main className="app-main">
      <Link to="/master" className="back-link">← Back to Master</Link>
      <h1 className="page-title">
        Rate Management <span className="page-title__accent">— Master</span>
      </h1>
      <p className="page-subtitle">
        Rate cards per (customer, vehicle group/type, duty type). Editing
        an effective rate creates a new row and closes the old one — duty
        slips that book before the change still see the old rate.
      </p>

      {/* Customer picker */}
      <section className="card card--accent" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Select customer</h3>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ minWidth: '260px', flex: 1 }}>
            <label htmlFor="rate-customer">Customer</label>
            <select
              id="rate-customer"
              value={selectedCustomerId === '' ? '' : String(selectedCustomerId)}
              onChange={(e) => setSelectedCustomerId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">-- select a customer --</option>
              {activeCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.company_name ? ` (${c.company_name})` : ''} — {c.client_type}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ minWidth: '180px' }}>
            <label htmlFor="rate-filter-group">Vehicle group</label>
            <select id="rate-filter-group" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
              <option value="all">All groups</option>
              {groupsQuery.data?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="form-field" style={{ minWidth: '180px' }}>
            <label htmlFor="rate-filter-type">Vehicle type</label>
            <select id="rate-filter-type" value={filterTypeId} onChange={(e) => setFilterTypeId(e.target.value)}>
              <option value="all">All types</option>
              {typesQuery.data?.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        {customersQuery.isError && (
          <div className="form-error form-error--server" role="alert" style={{ marginTop: '0.5rem' }}>
            Failed to load customers: {customersQuery.error instanceof Error ? customersQuery.error.message : 'unknown error'}
          </div>
        )}
      </section>

      {/* Rate matrix */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Rate matrix</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {selectedCustomerId !== '' && (
              <span className="badge badge--muted" data-testid="rate-count">
                {filteredRates.length} row{filteredRates.length === 1 ? '' : 's'}
              </span>
            )}
            {canEdit && selectedCustomerId !== '' && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setModalOpen(true)}
              >
                Add Rate
              </button>
            )}
          </div>
        </div>

        {actionNotice && (
          <div className="form-message form-message--ok" role="status" style={{ marginBottom: '0.5rem' }}>
            {actionNotice}
          </div>
        )}
        {cellError && (
          <div className="form-error form-error--server" role="alert" style={{ marginBottom: '0.5rem' }}>
            {cellError}
          </div>
        )}

        {selectedCustomerId === '' ? (
          <p style={{ color: 'var(--color-text-muted)' }} data-testid="rate-hint">
            Please select a customer to view rates.
          </p>
        ) : ratesQuery.isLoading ? (
          <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading rates…</div>
        ) : ratesQuery.isError ? (
          <div className="form-error form-error--server" role="alert">
            Failed to load: {ratesQuery.error instanceof Error ? ratesQuery.error.message : 'unknown error'}
          </div>
        ) : filteredRates.length === 0 ? (
          <p data-testid="rate-empty">No rates yet for this customer.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Type</th>
                  <th>Duty type</th>
                  {FIELD_HEADERS.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th>Effective from</th>
                  <th>Effective to</th>
                </tr>
              </thead>
              <tbody>
                {filteredRates.map((r) => {
                  const isClosed = r.effective_to != null;
                  return (
                    <tr key={r.id} className={isClosed ? 'data-table__row--inactive' : ''}>
                      <td>{r.vehicle_group_name ?? '—'}</td>
                      <td>{r.vehicle_type_name ?? '—'}</td>
                      <td>{r.duty_type}</td>
                      {FIELD_HEADERS.map((f) => {
                        const isEditing =
                          !isClosed &&
                          canEdit &&
                          editingCell?.rowId === r.id &&
                          editingCell?.field === f.key;
                        const v = r[f.key];
                        if (isEditing) {
                          return (
                            <td key={f.key}>
                              <input
                                type="number"
                                step="0.01"
                                value={cellDraft}
                                onChange={(e) => setCellDraft(e.target.value)}
                                onBlur={() => void commitCellEdit(r, f.key)}
                                onKeyDown={(e) => onCellKey(e, r, f.key)}
                                autoFocus
                                style={{ width: '80px' }}
                              />
                            </td>
                          );
                        }
                        return (
                          <td
                            key={f.key}
                            onClick={() => beginCellEdit(r.id, f.key, v)}
                            style={{
                              cursor: !isClosed && canEdit ? 'pointer' : 'default',
                              color: v == null ? 'var(--color-text-muted)' : undefined,
                            }}
                            data-testid={`cell-${r.id}-${f.key}`}
                          >
                            {v == null ? '—' : v}
                          </td>
                        );
                      })}
                      <td>{r.effective_from}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                          <span>{r.effective_to ?? '— (current)'}</span>
                          {canEdit && (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => void handleDelete(r)}
                              data-testid={`rate-delete-${r.id}`}
                              style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && selectedCustomerId !== '' && (
        <RateFormModal
          customerId={selectedCustomerId}
          groups={groupsQuery.data ?? []}
          types={typesQuery.data ?? []}
          busy={busy}
          onBusyChange={setBusy}
          onClose={() => { if (!busy) setModalOpen(false); }}
          onSaved={() => setModalOpen(false)}
        />
      )}
    </main>
  );
}
