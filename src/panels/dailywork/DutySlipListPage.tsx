import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { HybridDatePicker } from '../../components/HybridDatePicker';
import { DutySlipFormModal } from './DutySlipFormModal';
import type { DutySlipInitial } from './DutySlipFormModal';

/**
 * DutySlipListPage — daily-workhorse list (TAXI-801).
 *
 * Top: filter bar (booking_date from/to, customer, vehicle, status).
 * Below: TanStack-Table-shaped table with 10 columns + per-row Edit.
 * "New Duty Slip" button opens a placeholder modal — the real form
 * arrives in TAXI-802.
 *
 * Role gating: owner + operator see New / Edit; accountant + viewer
 * see the list read-only (no action buttons).
 */

interface DutySlipRow {
  id: number;
  duty_slip_no: string;
  booking_date: string;
  customer_id: number;
  customer_name: string | null;
  vehicle_id: number;
  vehicle_reg_no: string | null;
  duty_type: string;
  opening_km: number | null;
  closing_km: number | null;
  total_km: number | null;
  duty_start_dt: string;
  duty_end_dt: string | null;
  total_hours: number | null;
  base_amount: number | null;
  extra_km_amount: number | null;
  extra_hour_amount: number | null;
  night_halt_amount: number | null;
  driver_allowance: number | null;
  other_charges: number | null;
  total_amount: number | null;
  rate_id: number | null;
  status: string;
  // Fields needed by the form's edit mode (not in the list RPC, but
  // carried over for the form pre-fill).
  booking_ref: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  pickup_location: string | null;
  drop_location: string | null;
  other_charges_remarks: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  custom_rate_items: { label: string; amount: number }[];
}

interface CustomerLite { id: number; name: string; company_name: string | null; state: string; is_active: boolean }
interface VehicleLite  { id: number; registration_no: string; is_active: boolean }

const STATUS_OPTIONS = ['open', 'closed', 'billed', 'cancelled'] as const;

// TAXI-810 — client-side pagination. The full list can be 100s of
// rows; pagination keeps the DOM small and the table responsive.
const PAGE_SIZE = 20;

export function DutySlipListPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [filterCustomerId, setFilterCustomerId] = useState<string>('all');
  const [filterVehicleId, setFilterVehicleId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [page, setPage] = useState<number>(0);
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<DutySlipInitial | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCancel = async (c: DutySlipRow) => {
    if (!window.confirm(`Cancel duty slip ${c.duty_slip_no}? This is irreversible. Billed slips must be reversed in Billing first.`)) return;
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('cancel_duty_slip', { p_id: c.id });
    setBusy(false);
    if (rpcErr) { window.alert(rpcErr.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_company'] });
  };

  // TAXI-807 — Print placeholder. Cancelled slips are blocked (per MTP
  // step 3); billed slips are allowed (a printed copy of the source
  // duty slip alongside a bill is a normal request).
  const handlePrint = (c: DutySlipRow) => {
    if (c.status === 'cancelled') {
      window.alert('Cancelled duty slips cannot be printed.');
      return;
    }
    const url = `/print-placeholder.html?duty_slip_no=${encodeURIComponent(c.duty_slip_no)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // -- queries ----------------------------------------------------------------
  const slipsQuery = useQuery({
    queryKey: ['rpc', 'list_duty_slips_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_duty_slips_for_company');
      if (e) throw e;
      return (data ?? []) as DutySlipRow[];
    },
  });

  const customersQuery = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as CustomerLite[];
    },
  });

  const vehiclesQuery = useQuery({
    queryKey: ['rpc', 'list_vehicles_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicles_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleLite[];
    },
  });

  // -- filtering --------------------------------------------------------------
  const filtered = useMemo(() => {
    const rows = slipsQuery.data ?? [];
    return rows.filter((r) => {
      if (filterFrom && r.booking_date < filterFrom) return false;
      if (filterTo && r.booking_date > filterTo) return false;
      if (filterCustomerId !== 'all' && String(r.customer_id) !== filterCustomerId) return false;
      if (filterVehicleId !== 'all' && String(r.vehicle_id) !== filterVehicleId) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      return true;
    });
  }, [slipsQuery.data, filterFrom, filterTo, filterCustomerId, filterVehicleId, filterStatus]);

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [filterFrom, filterTo, filterCustomerId, filterVehicleId, filterStatus]);

  // Client-side pagination (TAXI-810 MTP step 2: 20 rows/page + Next button).
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // -- helpers ----------------------------------------------------------------
  const fmtHours = (h: number | null) => (h == null ? '—' : h.toFixed(2));
  const fmtKm = (k: number | null) => (k == null ? '—' : k.toFixed(0));
  const fmtMoney = (m: number | null) => (m == null ? '—' : `₹${m.toFixed(2)}`);

  return (
    <main className="app-main">
      <Link to="/daily-work" className="back-link">← Back to Daily Work</Link>
      <h1 className="page-title">
        Duty Slips <span className="page-title__accent">— Daily Work</span>
      </h1>
      <p className="page-subtitle">
        One row per booking. The form lands in TAXI-802 — this page is
        the list + filter shell.
      </p>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Duty slip list</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="badge badge--muted" data-testid="duty-slip-count">
              {filtered.length} row{filtered.length === 1 ? '' : 's'}
            </span>
            {canEdit && (
              <button
                type="button"
                className="btn btn--primary"
                data-testid="new-duty-slip-btn"
                onClick={() => { setEditing(null); setModalMode('add'); }}
              >
                New Duty Slip
              </button>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'flex-end',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
          }}
        >
          <HybridDatePicker
            id="filter-from"
            label="Booking from"
            value={filterFrom}
            onChange={setFilterFrom}
            testId="filter-from-today"
          />
          <HybridDatePicker
            id="filter-to"
            label="Booking to"
            value={filterTo}
            onChange={setFilterTo}
            testId="filter-to-today"
          />
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="filter-customer">Customer</label>
            <select
              id="filter-customer"
              value={filterCustomerId}
              onChange={(e) => setFilterCustomerId(e.target.value)}
            >
              <option value="all">All customers</option>
              {customersQuery.data
                ?.filter((c) => c.is_active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.company_name ? ` (${c.company_name})` : ''}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="filter-vehicle">Vehicle</label>
            <select
              id="filter-vehicle"
              value={filterVehicleId}
              onChange={(e) => setFilterVehicleId(e.target.value)}
            >
              <option value="all">All vehicles</option>
              {vehiclesQuery.data
                ?.filter((v) => v.is_active)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_no}
                  </option>
                ))}
            </select>
          </div>
          <div className="form-field" style={{ minWidth: '140px' }}>
            <label htmlFor="filter-status">Status</label>
            <select id="filter-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {slipsQuery.isLoading ? (
          <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading duty slips…</div>
        ) : slipsQuery.isError ? (
          <div className="form-error form-error--server" role="alert">
            Failed to load: {slipsQuery.error instanceof Error ? slipsQuery.error.message : 'unknown error'}
          </div>
        ) : filtered.length === 0 ? (
          <p data-testid="duty-slip-empty">
            {(slipsQuery.data ?? []).length === 0
              ? 'No duty slips yet. The form lands in TAXI-802.'
              : 'No duty slips match the current filters.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Duty slip no.</th>
                  <th>Booking date</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Duty type</th>
                  <th style={{ textAlign: 'right' }}>Total km</th>
                  <th style={{ textAlign: 'right' }}>Total hours</th>
                  <th style={{ textAlign: 'right' }}>Total amount</th>
                  <th>Status</th>
                  {canEdit && <th style={{ width: '110px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'data-table__row--inactive' : ''} data-testid={`duty-slip-row-${r.id}`}>
                    <td><code>{r.duty_slip_no}</code></td>
                    <td>{r.booking_date}</td>
                    <td>{r.customer_name ?? '—'}</td>
                    <td>{r.vehicle_reg_no ?? '—'}</td>
                    <td>{r.duty_type}</td>
                    <td style={{ textAlign: 'right' }}>{fmtKm(r.total_km)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtHours(r.total_hours)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(r.total_amount)}</td>
                    <td>{r.status}</td>
                    {canEdit && (
                      <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {r.status !== 'cancelled' && r.status !== 'billed' && (
                          <button
                            type="button"
                            className="btn"
                            data-testid={`duty-slip-edit-${r.id}`}
                            onClick={() => {
                            // The list query doesn't include every editable
                            // column; fetch the full row via get_duty_slip
                            // before opening the form so all fields populate.
                            (async () => {
                              setBusy(true);
                              const { data, error: e } = await supabase.rpc('get_duty_slip', { p_id: r.id });
                              setBusy(false);
                              if (e) { window.alert(e.message); return; }
                              const row = Array.isArray(data) ? data[0] : data;
                              if (!row) return;
                              setEditing({
                                id: r.id,
                                customer_id: r.customer_id,
                                vehicle_id: r.vehicle_id,
                                rate_id: r.rate_id,
                                duty_type: r.duty_type as DutySlipInitial['duty_type'],
                                booking_date: r.booking_date,
                                booking_ref: row.booking_ref,
                                guest_name: row.guest_name,
                                guest_phone: row.guest_phone,
                                pickup_location: row.pickup_location,
                                drop_location: row.drop_location,
                                duty_start_dt: r.duty_start_dt,
                                duty_end_dt: r.duty_end_dt,
                                opening_km: r.opening_km,
                                closing_km: r.closing_km,
                                extra_km_amount: r.extra_km_amount,
                                extra_hour_amount: r.extra_hour_amount,
                                night_halt_amount: r.night_halt_amount,
                                driver_allowance: r.driver_allowance,
                                other_charges: r.other_charges,
                                other_charges_remarks: row.other_charges_remarks,
                                driver_name: row.driver_name,
                                driver_phone: row.driver_phone,
                                custom_rate_items: Array.isArray(r.custom_rate_items) ? r.custom_rate_items : [],
                              });
                              setModalMode('edit');
                            })();
                          }}
                        >
                          Edit
                        </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          data-testid={`duty-slip-print-${r.id}`}
                          onClick={() => handlePrint(r)}
                          title="Print preview (M11)"
                          aria-label={`Print duty slip ${r.duty_slip_no}`}
                        >
                          🖨 Print
                        </button>
                        <button
                          type="button"
                          className="btn"
                          data-testid={`duty-slip-cancel-${r.id}`}
                          onClick={() => void handleCancel(r)}
                        >
                          Cancel
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAXI-810 — pagination footer (Prev / page indicator / Next) */}
        {filtered.length > PAGE_SIZE && (
          <div
            data-testid="duty-slip-pagination"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '0.75rem',
              marginTop: '0.5rem',
              borderTop: '1px solid var(--color-border)',
              fontSize: '0.9rem',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>
              Page {page + 1} of {pageCount} · {filtered.length} rows total
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                data-testid="duty-slip-page-prev"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn"
                data-testid="duty-slip-page-next"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </section>

      {modalMode && (
        <DutySlipFormModal
          mode={modalMode}
          initial={editing}
          busy={busy}
          onBusyChange={setBusy}
          onClose={() => { if (!busy) { setModalMode(null); setEditing(null); } }}
          onSaved={() => { setModalMode(null); setEditing(null); void queryClient.invalidateQueries({ queryKey: ['rpc','list_duty_slips_for_company'] }); }}
        />
      )}
    </main>
  );
}
