import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import {
  fetchData,
  getBlobURL,
  revokeBlobURLDelayed,
} from '../../services/PdfTemplateFactory';

/**
 * BillingPage — M9 / TAXI-903 rev2.
 *
 * Range-based lookup (per operator's request):
 *   - The operator types a Start and End duty slip number.
 *   - We call public.list_duty_slips_in_range(start, end) which
 *     returns EVERY slip in that lexical range (billed + unbilled
 *     + cancelled) for the caller's company.
 *   - Billed and cancelled slips appear read-only (checkbox
 *     disabled, row greys out, bill_no column populated).
 *   - After Generate Bill succeeds, we invalidate the query cache
 *     so bill_no updates — but the slip STAYS in the list (the
 *     operator's range persists).
 *
 * Single-bill constraint:
 *   - A bill can only contain slips from ONE customer (the
 *     generate_bill RPC enforces this).
 *   - When the operator starts ticking, we lock to the first
 *     selected slip's customer_id. Subsequent ticks on slips
 *     from other customers are blocked (checkbox disabled).
 */

interface SlipRow {
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
  bill_id: number | null;
  bill_no: string | null;
  status: string;
}

const isSelectable = (s: SlipRow): boolean =>
  s.status !== 'cancelled' && s.bill_id == null;

export function BillingPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  // Digit-only inputs for the slip_no range. We filter NUMERICALLY on
  // the trailing digits of duty_slip_no (after "DS-"), so typing "1"
  // and "0001" both match "DS-0001".
  const [startNoDigits, setStartNoDigits] = useState<string>('');
  const [endNoDigits,   setEndNoDigits]   = useState<string>('');
  // Numbers = applied range; null = no bound. Stored as numbers so
  // the client-side filter can compare correctly.
  const [numericStart, setNumericStart] = useState<number | null>(null);
  const [numericEnd,   setNumericEnd]   = useState<number | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lockedCustomerId, setLockedCustomerId] = useState<number | null>(null);
  const [remarks, setRemarks] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [actionNotice, setActionNotice] = useState<
    { billNo: string; total: number } | null
  >(null);

  // -- queries ----------------------------------------------------------------
  // The RPC always fetches every slip for the company (NULL bounds).
  // The numeric range filter (numericStart / numericEnd) is applied
  // client-side after the fetch, so "1" and "0001" both match
  // "DS-0001" — the operator doesn't need to know the padding.
  const slipsQuery = useQuery({
    queryKey: ['rpc', 'list_duty_slips_in_range', 'all', companyId ?? 'none'],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc(
        'list_duty_slips_in_range',
        { p_start_no: null, p_end_no: null },
      );
      if (e) throw e;
      return (data ?? []) as SlipRow[];
    },
  });

  // -- helpers ----------------------------------------------------------------
  // Extract the numeric tail of a slip_no like "DS-0045" → 45.
  const slipNoNumericTail = (slipNo: string): number => {
    const m = slipNo.match(/(\d+)(?!.*\d)/);
    if (!m) return -1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : -1;
  };

  const allSlips = useMemo(() => slipsQuery.data ?? [], [slipsQuery.data]);
  // Apply numeric range filter on top of the unfiltered list.
  const slips = useMemo(() => {
    if (numericStart == null && numericEnd == null) return allSlips;
    return allSlips.filter((s) => {
      const n = slipNoNumericTail(s.duty_slip_no);
      if (numericStart != null && n < numericStart) return false;
      if (numericEnd   != null && n > numericEnd)   return false;
      return true;
    });
  }, [allSlips, numericStart, numericEnd]);

  const selectedSlips = useMemo(
    () => slips.filter((s) => selectedIds.has(s.id)),
    [slips, selectedIds],
  );

  // Reset selection when the applied range changes.
  useEffect(() => {
    setSelectedIds(new Set());
    setLockedCustomerId(null);
    setRemarks('');
  }, [numericStart, numericEnd]);

  const totalBase = selectedSlips.reduce(
    (acc, s) => acc + (Number(s.base_amount) || 0), 0,
  );
  const totalExtra = selectedSlips.reduce(
    (acc, s) =>
      acc +
      (Number(s.extra_km_amount) || 0) +
      (Number(s.extra_hour_amount) || 0) +
      (Number(s.night_halt_amount) || 0) +
      (Number(s.driver_allowance) || 0) +
      (Number(s.other_charges) || 0),
    0,
  );
  const totalBeforeTax = totalBase + totalExtra;

  // Range helpers
  // Parse digit input as a number (handles "1" / "0001" / "45" all
  // the same way). Empty → null (no bound).
  const digitsToSlipNumber = (digits: string): number | null => {
    const cleaned = digits.replace(/\D+/g, '');
    if (cleaned === '') return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  };

  const applyRange = () => {
    const s = digitsToSlipNumber(startNoDigits);
    const e = digitsToSlipNumber(endNoDigits);
    if (s != null && e != null && s > e) {
      window.alert('Start slip number must be ≤ end slip number.');
      return;
    }
    setNumericStart(s);
    setNumericEnd(e);
  };

  // Selection helpers
  const toggleOne = (s: SlipRow) => {
    if (!canEdit || !isSelectable(s)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) {
        next.delete(s.id);
        // If we removed the locked-customer slip, unlock.
        if (next.size === 0) setLockedCustomerId(null);
        return next;
      }
      // First selection: lock the customer.
      if (lockedCustomerId == null) {
        setLockedCustomerId(s.customer_id);
        next.add(s.id);
        return next;
      }
      // Subsequent: must match the locked customer.
      if (s.customer_id !== lockedCustomerId) {
        window.alert(
          `A bill can only contain slips from one customer. Slip ${s.duty_slip_no} belongs to a different customer than the already-ticked slip(s).`,
        );
        return prev;
      }
      next.add(s.id);
      return next;
    });
  };

  const toggleAllSelectable = () => {
    if (!canEdit) return;
    const selectable = slips.filter(isSelectable);
    if (selectable.length === 0) return;
    // Only tick the slips from one customer (the first selectable's).
    const target = selectable[0].customer_id;
    const ids = new Set(
      selectable.filter((s) => s.customer_id === target).map((s) => s.id),
    );
    setSelectedIds(ids);
    setLockedCustomerId(target);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLockedCustomerId(null);
  };

  const handleGenerate = async () => {
    if (selectedSlips.length === 0) {
      window.alert('Select at least one duty slip to bill.');
      return;
    }
    if (lockedCustomerId == null) return;
    const summary =
      `Generate bill?\n\n` +
      `Customer: ${selectedSlips[0]?.customer_name ?? '?'}\n` +
      `Duty slips: ${selectedSlips.length}\n` +
      `Base: ${totalBase.toFixed(2)}\n` +
      `Extras: ${totalExtra.toFixed(2)}\n` +
      `Pre-tax total: ${totalBeforeTax.toFixed(2)}`;
    if (!window.confirm(summary)) return;

    setBusy(true);
    const { data, error: rpcErr } = await supabase.rpc('generate_bill', {
      p_customer_id: lockedCustomerId,
      p_duty_slip_ids: Array.from(selectedIds),
      p_remarks: remarks || null,
      p_bill_date: new Date().toISOString().slice(0, 10),
    });
    setBusy(false);
    if (rpcErr) {
      window.alert(rpcErr.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setActionNotice({
      billNo: row?.bill_no ?? '?',
      total: Number(row?.grand_total ?? 0),
    });
    setTimeout(() => setActionNotice(null), 8000);

    // Refresh both this list (so bill_no updates) and the duty-slip
    // list (so the duty slip page reflects the new bill_id).
    await queryClient.invalidateQueries({
      queryKey: ['rpc', 'list_duty_slips_in_range'],
    });
    await queryClient.invalidateQueries({
      queryKey: ['rpc', 'list_duty_slips_for_company'],
    });
    // Refresh Change / Cancel Bill page so the new bill shows up there.
    await queryClient.invalidateQueries({
      queryKey: ['rpc', 'list_bills_for_company'],
    });

    // The slip STAYS in the list — that's the operator's directive.
    // Just clear the selection + remarks so they can pick the next batch.
    setSelectedIds(new Set());
    setLockedCustomerId(null);
    setRemarks('');
  };

  // -- display helpers --------------------------------------------------------
  const fmtHours = (h: number | null) => (h == null ? '—' : h.toFixed(2));
  const fmtKm = (k: number | null) => (k == null ? '—' : k.toFixed(0));
  const fmtMoney = (m: number | null) => (m == null ? '—' : `₹${m.toFixed(2)}`);

  const lockedCustomerName =
    lockedCustomerId != null
      ? slips.find((s) => s.customer_id === lockedCustomerId)?.customer_name ?? `customer #${lockedCustomerId}`
      : null;

  // -- render -----------------------------------------------------------------
  return (
    <main className="app-main">
      <Link to="/daily-work" className="back-link">← Back to Daily Work</Link>
      <h1 className="page-title">
        Billing <span className="page-title__accent">— Daily Work</span>
      </h1>
      <p className="page-subtitle">
        Set a duty slip number range, tick the unbilled slips, click <em>Generate Bill</em>.
        Billed slips stay visible — they're shown read-only with their bill number.
      </p>

      <section className="card">
        {/* Range controls */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          {/* Digit-only inputs with auto-prepended "DS-" prefix. Empty
              inputs + Search = "show every slip in the company". */}
          <div className="form-field" style={{ minWidth: '160px' }}>
            <label htmlFor="bill-range-start">Start slip no.</label>
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
                DS-
              </span>
              <input
                id="bill-range-start"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={startNoDigits}
                onChange={(e) => setStartNoDigits(e.target.value.replace(/\D+/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') applyRange(); }}
                placeholder="0001"
                data-testid="bill-range-start"
                disabled={!canEdit}
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
            <label htmlFor="bill-range-end">End slip no.</label>
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
                DS-
              </span>
              <input
                id="bill-range-end"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                value={endNoDigits}
                onChange={(e) => setEndNoDigits(e.target.value.replace(/\D+/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') applyRange(); }}
                placeholder="0050"
                data-testid="bill-range-end"
                disabled={!canEdit}
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
          <button
            type="button"
            className="btn btn--primary"
            data-testid="bill-show-range-btn"
            disabled={!canEdit || slipsQuery.isFetching}
            onClick={applyRange}
          >
            Search
          </button>
          <button
            type="button"
            className="btn"
            data-testid="bill-clear-range-btn"
            disabled={!canEdit}
            onClick={() => {
              setStartNoDigits('');
              setEndNoDigits('');
              setNumericStart(null);
              setNumericEnd(null);
            }}
            style={{ paddingBottom: '0.45rem' }}
          >
            Clear
          </button>
          <span
            data-testid="bill-range-summary"
            style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}
          >
            {numericStart != null || numericEnd != null
              ? `Showing DS-${numericStart ?? 'any'} – DS-${numericEnd ?? 'any'} (${slips.length} row${slips.length === 1 ? '' : 's'})`
              : `Showing all slips (${slips.length} row${slips.length === 1 ? '' : 's'})`}
          </span>
        </div>

        {actionNotice && (
          <div
            className="form-message form-message--ok"
            role="status"
            data-testid="bill-success-notice"
            style={{
              marginTop: '0.75rem',
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>
              Bill <strong data-testid="bill-success-no">{actionNotice.billNo}</strong> created for{' '}
              <strong>₹{actionNotice.total.toFixed(2)}</strong>.
            </span>
            <a
              href="#"
              role="button"
              data-testid="bill-print-link"
              data-busy={printing ? 'true' : 'false'}
              className="btn"
              style={{
                padding: '0.25rem 0.6rem',
                fontSize: '0.85rem',
                opacity: printing ? 0.6 : 1,
                pointerEvents: printing ? 'none' : 'auto',
              }}
              onClick={(e) => {
                e.preventDefault();
                if (printing) return;
                setPrinting(true);
                fetchData('bill', actionNotice.billNo)
                  .then((data) => getBlobURL('bill', data))
                  .then((url) => {
                    window.open(url, '_blank', 'noopener,noreferrer');
                    revokeBlobURLDelayed(url);
                  })
                  .catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    window.alert(`Print failed: ${msg}`);
                  })
                  .finally(() => setPrinting(false));
              }}
            >
              {printing ? 'Generating…' : '🖨 Print Bill'}
            </a>
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

        {/* Slip list */}
        <div style={{ marginTop: '1rem' }}>
          {numericStart == null && numericEnd == null ? (
            <p data-testid="bill-empty" style={{ color: 'var(--color-text-muted)' }}>
              All slips are visible. Type an optional range above and click Search to narrow.
            </p>
          ) : slipsQuery.isLoading ? (
            <p data-testid="bill-empty" style={{ color: 'var(--color-text-muted)' }}>
              Set a Start and End slip number above (optional) and click <em>Search</em>. Empty inputs show every slip in the company.
            </p>
          ) : slipsQuery.isLoading ? (
            <div className="loading"><span className="loading__spinner" />Loading slips…</div>
          ) : slipsQuery.isError ? (
            <div className="form-error form-error--server" role="alert">
              Failed to load: {slipsQuery.error instanceof Error ? slipsQuery.error.message : 'unknown error'}
            </div>
          ) : slips.length === 0 ? (
            <p data-testid="bill-empty" style={{ color: 'var(--color-text-muted)' }}>
              No duty slips in that range.
            </p>
          ) : (
            <>
              <table className="data-table" data-testid="bill-slip-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}>
                      <input
                        type="checkbox"
                        data-testid="bill-select-all"
                        checked={
                          selectedSlips.length > 0 &&
                          slips.filter(isSelectable).every(
                            (s) =>
                              selectedIds.has(s.id) ||
                              (lockedCustomerId != null && s.customer_id !== lockedCustomerId),
                          ) &&
                          selectedSlips.every(
                            (s) =>
                              slips.find((x) => x.id === s.id)?.customer_id === lockedCustomerId,
                          )
                        }
                        onChange={() => {
                          if (selectedSlips.length > 0) clearSelection();
                          else toggleAllSelectable();
                        }}
                        disabled={!canEdit}
                        aria-label="Select all billable slips in this range"
                      />
                    </th>
                    <th>Duty slip no.</th>
                    <th>Booking date</th>
                    <th>Customer</th>
                    <th>Vehicle</th>
                    <th>Duty type</th>
                    <th style={{ textAlign: 'right' }}>Total km</th>
                    <th style={{ textAlign: 'right' }}>Total hours</th>
                    <th style={{ textAlign: 'right' }}>Total ₹</th>
                    <th>Status</th>
                    <th>Bill no.</th>
                  </tr>
                </thead>
                <tbody>
                  {slips.map((s) => {
                    const selectable = isSelectable(s);
                    const blockedByCustomer =
                      lockedCustomerId != null &&
                      s.customer_id !== lockedCustomerId &&
                      !selectedIds.has(s.id);
                    const checked = selectedIds.has(s.id);
                    return (
                      <tr
                        key={s.id}
                        data-testid={`bill-slip-row-${s.id}`}
                        className={
                          (s.status === 'cancelled' || s.bill_id != null
                            ? 'data-table__row--inactive '
                            : '') +
                          (checked ? 'data-table__row--selected' : '')
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            data-testid={`bill-slip-check-${s.id}`}
                            checked={checked}
                            onChange={() => toggleOne(s)}
                            disabled={!canEdit || !selectable || blockedByCustomer}
                            aria-label={`Select duty slip ${s.duty_slip_no}`}
                          />
                        </td>
                        <td><code>{s.duty_slip_no}</code></td>
                        <td>{s.booking_date}</td>
                        <td>{s.customer_name ?? '—'}</td>
                        <td>{s.vehicle_reg_no ?? '—'}</td>
                        <td>{s.duty_type}</td>
                        <td style={{ textAlign: 'right' }}>{fmtKm(s.total_km)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtHours(s.total_hours)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(s.total_amount)}</td>
                        <td>{s.status}</td>
                        <td>{s.bill_no ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Totals preview + remarks + Generate Bill */}
        {slips.length > 0 && (
          <div
            data-testid="bill-totals"
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-2)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
            }}
          >
            <div className="form-field" style={{ margin: 0 }}>
              <label htmlFor="bill-remarks">Remarks (optional)</label>
              <textarea
                id="bill-remarks"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                disabled={!canEdit || selectedSlips.length === 0}
                placeholder="Optional remarks to print on the bill"
                style={{ resize: 'vertical', minHeight: '2.5rem' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem', alignItems: 'baseline' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Selected slips</span>
              <span data-testid="bill-count" style={{ fontWeight: 600 }}>{selectedSlips.length}</span>
              {lockedCustomerName && (
                <>
                  <span style={{ color: 'var(--color-text-muted)' }}>Customer</span>
                  <span data-testid="bill-customer" style={{ fontWeight: 600 }}>{lockedCustomerName}</span>
                </>
              )}
              <span style={{ color: 'var(--color-text-muted)' }}>Base</span>
              <span data-testid="bill-base" style={{ fontWeight: 600 }}>₹{totalBase.toFixed(2)}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>Extras</span>
              <span data-testid="bill-extras" style={{ fontWeight: 600 }}>₹{totalExtra.toFixed(2)}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>Pre-tax total</span>
              <span data-testid="bill-pretax" style={{ fontWeight: 600 }}>₹{totalBeforeTax.toFixed(2)}</span>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700 }}>Total (GST computed at bill time)</span>
              <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>—</span>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="bill-generate-btn"
                  disabled={selectedSlips.length === 0 || busy || lockedCustomerId == null}
                  onClick={() => void handleGenerate()}
                >
                  {busy ? 'Generating…' : 'Generate Bill'}
                </button>
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                  Read-only — your role can't generate bills.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}