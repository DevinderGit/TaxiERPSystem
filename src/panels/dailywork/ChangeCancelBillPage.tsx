import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

/**
 * ChangeCancelBillPage — M10 / TAXI-1001 / 1002 / 1003 / 1004 / 1005.
 *
 * One page that handles all M10 flows:
 *   - Lists every bill. Filter bar: customer dropdown + bill_no range
 *     (digit-only inputs with auto-prepended "BL-" prefix) +
 *     "Show cancelled" toggle + Search button + Clear button. The
 *     bill-no range + show-cancelled toggle apply only on Search
 *     click (per operator feedback — avoids re-filtering on every
 *     keystroke). Customer dropdown still applies immediately.
 *   - Per-bill actions:
 *       Edit  → opens edit-bill metadata modal (bill_date + remarks only).
 *       Slips → opens add/remove-slip modal (TAX-1003).
 *       Cancel → confirmation dialog with cancel reason (TAX-1004).
 *       Print → opens /print-placeholder.html?bill_no=<no> in a new tab.
 *   - Cancelled bills greyed out; Edit + Slips + Cancel buttons hidden.
 */

interface BillRow {
  id: number;
  bill_no: string;
  bill_date: string;
  customer_id: number;
  customer_name: string | null;
  customer_state: string | null;
  base_amount: number | null;
  extra_amount: number | null;
  total_before_tax: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  total_tax: number | null;
  total_after_tax: number | null;
  grand_total: number | null;
  remarks: string | null;
  status: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  duty_slip_count: number;
}

interface SlipRow {
  id: number;
  duty_slip_no: string;
  booking_date: string;
  duty_type: string;
  base_amount: number | null;
  total_amount: number | null;
  status: string;
  already_on_bill: boolean;
}

const fmtMoney = (m: number | null) => (m == null ? '—' : `₹${m.toFixed(2)}`);

export function ChangeCancelBillPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  // Customer filter applies immediately. Bill-no range + show-cancelled
  // only apply after the operator clicks Search (per operator feedback:
  // "I want a Search button").
  const [filterCustomerId, setFilterCustomerId] = useState<string>('all');
  const [billNoFromDigits, setBillNoFromDigits] = useState<string>('');
  const [billNoToDigits,   setBillNoToDigits]   = useState<string>('');
  const [showCancelled, setShowCancelled] = useState<boolean>(false);
  // Applied filters — null means "no bound". We store the digits as
  // numbers (not strings) so "1" and "0001" both compare equal to
  // bill BL-0001 (numeric 1).
  const [appliedFilter, setAppliedFilter] = useState<{
    billNoFrom: number | null;
    billNoTo: number | null;
    showCancelled: boolean;
  }>({ billNoFrom: null, billNoTo: null, showCancelled: false });

  const [editingBill, setEditingBill] = useState<BillRow | null>(null);
  const [slipsBill, setSlipsBill] = useState<BillRow | null>(null);
  const [cancellingBill, setCancellingBill] = useState<BillRow | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [page, setPage] = useState<number>(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [filterCustomerId, appliedFilter]);

  // Parse the digit-only input as a number. "//" strips non-digits
  // so "0001" and "1" both → 1. Empty → null (no bound).
  const digitsToBillNoNumber = (digits: string): number | null => {
    const cleaned = digits.replace(/\D+/g, '');
    if (cleaned === '') return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  };

  // Extract the numeric tail of a bill_no like "BL-0045" → 45.
  // ("BL-0001" → 1, "BL-1" → 1, "BL-1A" → 1 — anything before the
  // first non-digit after the prefix is captured.)
  const billNoNumericTail = (billNo: string): number => {
    const m = billNo.match(/(\d+)(?!.*\d)/);
    if (!m) return -1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : -1;
  };

  const handleSearch = () => {
    const f = digitsToBillNoNumber(billNoFromDigits);
    const t = digitsToBillNoNumber(billNoToDigits);
    if (f != null && t != null && f > t) {
      window.alert('From number must be ≤ to number.');
      return;
    }
    setAppliedFilter({
      billNoFrom: f,
      billNoTo:   t,
      showCancelled,
    });
  };

  const handleClearFilters = () => {
    setBillNoFromDigits('');
    setBillNoToDigits('');
    setShowCancelled(false);
    setAppliedFilter({ billNoFrom: null, billNoTo: null, showCancelled: false });
  };

  // Allow Enter inside a digit input to trigger Search.
  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Customers for filter dropdown
  const customersQuery = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as { id: number; name: string; company_name: string | null; is_active: boolean }[];
    },
  });

  const billsQuery = useQuery({
    queryKey: ['rpc', 'list_bills_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_bills_for_company');
      if (e) throw e;
      return (data ?? []) as BillRow[];
    },
  });

  const filtered = useMemo(() => {
    const rows = billsQuery.data ?? [];
    return rows.filter((r) => {
      if (filterCustomerId !== 'all' && String(r.customer_id) !== filterCustomerId) return false;
      if (appliedFilter.billNoFrom != null || appliedFilter.billNoTo != null) {
        const n = billNoNumericTail(r.bill_no);
        if (appliedFilter.billNoFrom != null && n <  appliedFilter.billNoFrom) return false;
        if (appliedFilter.billNoTo   != null && n >  appliedFilter.billNoTo)   return false;
      }
      if (!appliedFilter.showCancelled && r.status === 'cancelled') return false;
      return true;
    });
  }, [billsQuery.data, filterCustomerId, appliedFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  return (
    <main className="app-main">
      <Link to="/daily-work" className="back-link">← Back to Daily Work</Link>
      <h1 className="page-title">
        Change / Cancel Bill <span className="page-title__accent">— Daily Work</span>
      </h1>
      <p className="page-subtitle">
        Edit metadata, add/remove duty slips, or cancel a bill. Cancelled bills stay in the list for audit.
      </p>

      <section className="card">
        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="ccb-customer">Customer</label>
            <select
              id="ccb-customer"
              value={filterCustomerId}
              onChange={(e) => setFilterCustomerId(e.target.value)}
            >
              <option value="all">All customers</option>
              {customersQuery.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {/* Digit-only bill-no inputs with the "BL-" prefix prepended */}
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="ccb-from">Bill no. from</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  padding: '0.45rem 0.4rem 0.45rem 0.7rem',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'monospace',
                  background: 'var(--color-surface-2)',
                  borderRight: '1px solid var(--color-border)',
                  borderTopLeftRadius: 'var(--radius-sm)',
                  borderBottomLeftRadius: 'var(--radius-sm)',
                }}
              >
                BL-
              </span>
              <input
                id="ccb-from"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={billNoFromDigits}
                onChange={(e) => setBillNoFromDigits(e.target.value.replace(/\D+/g, ''))}
                onKeyDown={handleSearchKey}
                placeholder="0001"
                data-testid="ccb-billno-from"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.6rem',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  border: 'none',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="ccb-to">Bill no. to</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  padding: '0.45rem 0.4rem 0.45rem 0.7rem',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'monospace',
                  background: 'var(--color-surface-2)',
                  borderRight: '1px solid var(--color-border)',
                  borderTopLeftRadius: 'var(--radius-sm)',
                  borderBottomLeftRadius: 'var(--radius-sm)',
                }}
              >
                BL-
              </span>
              <input
                id="ccb-to"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={billNoToDigits}
                onChange={(e) => setBillNoToDigits(e.target.value.replace(/\D+/g, ''))}
                onKeyDown={handleSearchKey}
                placeholder="0050"
                data-testid="ccb-billno-to"
                style={{
                  flex: 1,
                  padding: '0.45rem 0.6rem',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  border: 'none',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: 'var(--color-text-muted)',
              fontSize: '0.85rem',
              paddingBottom: '0.4rem',
            }}
          >
            <input
              type="checkbox"
              data-testid="ccb-show-cancelled"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            Show cancelled bills
          </label>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="ccb-search-btn"
            disabled={billsQuery.isFetching}
            onClick={handleSearch}
            style={{ paddingBottom: '0.45rem' }}
          >
            {billsQuery.isFetching ? 'Searching…' : 'Search'}
          </button>
          <button
            type="button"
            className="btn"
            data-testid="ccb-clear-btn"
            onClick={handleClearFilters}
            style={{ paddingBottom: '0.45rem' }}
          >
            Clear
          </button>
          <span
            data-testid="ccb-row-count"
            style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', paddingBottom: '0.4rem' }}
          >
            {filtered.length} row{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {actionNotice && (
          <div
            className="form-message form-message--ok"
            role="status"
            data-testid="ccb-success-notice"
            style={{
              marginBottom: '0.75rem',
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>{actionNotice}</span>
            <button
              type="button"
              className="btn"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.85rem' }}
              onClick={() => setActionNotice(null)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Table */}
        {billsQuery.isLoading ? (
          <div className="loading"><span className="loading__spinner" />Loading bills…</div>
        ) : billsQuery.isError ? (
          <div className="form-error form-error--server" role="alert">
            Failed to load: {billsQuery.error instanceof Error ? billsQuery.error.message : 'unknown error'}
          </div>
        ) : filtered.length === 0 ? (
          <p data-testid="ccb-empty" style={{ color: 'var(--color-text-muted)' }}>
            No bills match the current filters.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" data-testid="ccb-table">
              <thead>
                <tr>
                  <th>Bill no.</th>
                  <th>Bill date</th>
                  <th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Slips</th>
                  <th style={{ textAlign: 'right' }}>Base</th>
                  <th style={{ textAlign: 'right' }}>Tax</th>
                  <th style={{ textAlign: 'right' }}>Grand total</th>
                  <th>Status</th>
                  <th style={{ width: canEdit ? '240px' : '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => {
                  const cancelled = r.status === 'cancelled';
                  return (
                    <tr
                      key={r.id}
                      data-testid={`ccb-row-${r.id}`}
                      className={cancelled ? 'data-table__row--inactive' : ''}
                    >
                      <td><code>{r.bill_no}</code></td>
                      <td>{r.bill_date}</td>
                      <td>{r.customer_name ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.duty_slip_count}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.base_amount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.total_tax)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.grand_total)}</td>
                      <td>{r.status}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn"
                            data-testid={`ccb-print-${r.id}`}
                            onClick={() =>
                              window.open(
                                `/print-placeholder.html?bill_no=${encodeURIComponent(r.bill_no)}`,
                                '_blank',
                                'noopener,noreferrer',
                              )
                            }
                          >
                            🖨
                          </button>
                          {canEdit && !cancelled && (
                            <>
                              <button
                                type="button"
                                className="btn"
                                data-testid={`ccb-edit-${r.id}`}
                                onClick={() => setEditingBill(r)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn"
                                data-testid={`ccb-slips-${r.id}`}
                                onClick={() => setSlipsBill(r)}
                              >
                                Slips
                              </button>
                              <button
                                type="button"
                                className="btn"
                                data-testid={`ccb-cancel-${r.id}`}
                                onClick={() => setCancellingBill(r)}
                                style={{ color: 'var(--color-warning)' }}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {cancelled && (
                            <span
                              title={r.cancel_reason ?? ''}
                              style={{ fontStyle: 'italic', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}
                            >
                              cancelled
                            </span>
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

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div
            data-testid="ccb-pagination"
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
            <span>Page {page + 1} of {pageCount} · {filtered.length} rows total</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                data-testid="ccb-page-prev"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn"
                data-testid="ccb-page-next"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modals */}
      {editingBill && (
        <EditBillMetadataModal
          bill={editingBill}
          onClose={() => setEditingBill(null)}
          onSaved={() => {
            setEditingBill(null);
            setActionNotice(`Bill ${editingBill.bill_no} updated.`);
            setTimeout(() => setActionNotice(null), 5000);
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_bills_for_company'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_in_range'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_company'] });
          }}
        />
      )}
      {slipsBill && (
        <AddRemoveSlipsModal
          bill={slipsBill}
          onClose={() => setSlipsBill(null)}
          onSaved={(msg) => {
            setSlipsBill(null);
            setActionNotice(msg);
            setTimeout(() => setActionNotice(null), 5000);
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_bills_for_company'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_in_range'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_company'] });
          }}
        />
      )}
      {cancellingBill && (
        <CancelBillModal
          bill={cancellingBill}
          onClose={() => setCancellingBill(null)}
          onSaved={() => {
            setCancellingBill(null);
            setActionNotice(`Bill ${cancellingBill.bill_no} cancelled.`);
            setTimeout(() => setActionNotice(null), 5000);
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_bills_for_company'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_in_range'] });
            void queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_company'] });
          }}
        />
      )}
    </main>
  );
}

// ============================================================
// Edit Bill Metadata — TAXI-1002
// ============================================================
function EditBillMetadataModal({
  bill,
  onClose,
  onSaved,
}: {
  bill: BillRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [billDate, setBillDate] = useState<string>(bill.bill_date);
  const [remarks, setRemarks] = useState<string>(bill.remarks ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (!billDate) { setError('Bill date is required.'); return; }
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('update_bill_metadata', {
      p_bill_id: bill.id, p_bill_date: billDate, p_remarks: remarks,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    onSaved();
  };

  return (
    <ModalShell title={`Edit Bill ${bill.bill_no}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div className="form-field">
          <label>Customer</label>
          <input type="text" value={bill.customer_name ?? ''} disabled />
        </div>
        <div className="form-field">
          <label htmlFor="ebm-date">Bill date</label>
          <input
            id="ebm-date"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            data-testid="ebm-date-input"
          />
        </div>
        <div className="form-field">
          <label htmlFor="ebm-remarks">Remarks</label>
          <textarea
            id="ebm-remarks"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            data-testid="ebm-remarks-input"
            placeholder="Optional"
            style={{ resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          <span>Grand total (read-only):</span>
          <span><strong>{fmtMoney(bill.grand_total)}</strong></span>
        </div>
        {error && <div className="form-error form-error--server" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="ebm-save-btn"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Add / Remove Duty Slips — TAXI-1003
// ============================================================
function AddRemoveSlipsModal({
  bill,
  onClose,
  onSaved,
}: {
  bill: BillRow;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const slipsQuery = useQuery({
    queryKey: ['rpc', 'list_duty_slips_for_bill_customer', bill.id],
    enabled: bill != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_duty_slips_for_bill_customer', { p_bill_id: bill.id });
      if (e) throw e;
      return (data ?? []) as SlipRow[];
    },
  });

  const onBill = slipsQuery.data?.filter((s) => s.already_on_bill) ?? [];
  const offBill = slipsQuery.data?.filter((s) => !s.already_on_bill) ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async (slipId: number) => {
    setError(null);
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('remove_duty_slip_from_bill', {
      p_bill_id: bill.id, p_duty_slip_id: slipId,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_bill_customer', bill.id] });
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_bills_for_company'] });
    onSaved(`Slip removed from bill ${bill.bill_no}.`);
  };
  const handleAdd = async (slipId: number) => {
    setError(null);
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('add_duty_slip_to_bill', {
      p_bill_id: bill.id, p_duty_slip_id: slipId,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_bill_customer', bill.id] });
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_bills_for_company'] });
    onSaved(`Slip added to bill ${bill.bill_no}.`);
  };

  return (
    <ModalShell title={`Add / Remove Slips — Bill ${bill.bill_no}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Currently on bill */}
        <div>
          <h4 style={{ margin: '0 0 0.5rem' }}>Currently linked ({onBill.length})</h4>
          {slipsQuery.isLoading ? (
            <div className="loading"><span className="loading__spinner" />Loading…</div>
          ) : onBill.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No slips on this bill yet.</p>
          ) : (
            <table className="data-table" data-testid="ars-on-bill-table">
              <thead>
                <tr><th>Slip no.</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th /></tr>
              </thead>
              <tbody>
                {onBill.map((s) => (
                  <tr key={s.id} data-testid={`ars-on-row-${s.id}`}>
                    <td><code>{s.duty_slip_no}</code></td>
                    <td>{s.booking_date}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(s.total_amount)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        data-testid={`ars-remove-${s.id}`}
                        disabled={busy}
                        onClick={() => void handleRemove(s.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Available to add */}
        <div>
          <h4 style={{ margin: '0 0 0.5rem' }}>Available to add ({offBill.length})</h4>
          {slipsQuery.isLoading ? (
            <div className="loading"><span className="loading__spinner" />Loading…</div>
          ) : offBill.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No unbilled slips for this customer.</p>
          ) : (
            <table className="data-table" data-testid="ars-off-bill-table">
              <thead>
                <tr><th>Slip no.</th><th>Date</th><th style={{ textAlign: 'right' }}>Total</th><th /></tr>
              </thead>
              <tbody>
                {offBill.map((s) => (
                  <tr key={s.id} data-testid={`ars-off-row-${s.id}`}>
                    <td><code>{s.duty_slip_no}</code></td>
                    <td>{s.booking_date}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(s.total_amount)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary"
                        data-testid={`ars-add-${s.id}`}
                        disabled={busy}
                        onClick={() => void handleAdd(s.id)}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {error && (
        <div className="form-error form-error--server" role="alert" style={{ marginTop: '0.75rem' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Done</button>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Cancel Bill — TAXI-1004
// ============================================================
function CancelBillModal({
  bill,
  onClose,
  onSaved,
}: {
  bill: BillRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    if (reason.trim().length < 10) {
      setError('Cancel reason is required (min 10 characters).');
      return;
    }
    const summary =
      `Cancel bill ${bill.bill_no}?\n\n` +
      `This is IRREVERSIBLE. Linked duty slips will be freed. A reversal ` +
      `ledger entry will be posted.\n\n` +
      `Grand total: ₹${bill.grand_total?.toFixed(2) ?? '—'}`;
    if (!window.confirm(summary)) return;

    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('cancel_bill', {
      p_bill_id: bill.id, p_cancel_reason: reason,
    });
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    onSaved();
  };

  return (
    <ModalShell title={`Cancel Bill ${bill.bill_no}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div
          role="alert"
          style={{
            padding: '0.6rem 0.8rem',
            background: 'rgba(234, 179, 8, 0.15)',
            border: '1px solid var(--color-warning)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9rem',
          }}
        >
          ⚠ Cancelling a bill is <strong>irreversible</strong>. Linked duty slips will be freed and can be re-billed with a new bill number.
        </div>
        <div className="form-field">
          <label htmlFor="cb-reason">Cancel reason (required, min 10 chars)</label>
          <textarea
            id="cb-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="cb-reason-input"
            placeholder="e.g. Customer disputed charges over phone"
            style={{ resize: 'vertical' }}
          />
        </div>
        {error && <div className="form-error form-error--server" role="alert">{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Back</button>
          <button
            type="button"
            className="btn"
            data-testid="cb-confirm-btn"
            onClick={() => void handleConfirm()}
            disabled={busy}
            style={{ background: 'var(--color-warning)', color: '#0c0c0e' }}
          >
            {busy ? 'Cancelling…' : 'Cancel bill'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// ModalShell — shared dialog chrome
// ============================================================
function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: wide ? '1080px' : '720px',
          width: '95%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '1.5rem',
          position: 'relative',
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: 'absolute', top: '0.5rem', right: '0.75rem',
            background: 'transparent', border: 'none', color: 'var(--color-text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1,
          }}
        >
          ×
        </button>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}