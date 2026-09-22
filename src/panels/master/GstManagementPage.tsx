import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

/**
 * GstManagementPage — per-customer GST config (TAXI-701).
 *
 * Top: customer dropdown (active only).
 * Below: read-only summary banner ("Customer in X, company in Y, therefore
 *        IGST | CGST+SGST applies").
 * Below: edit form with the right rate fields editable based on
 *        inter/intra state + effective_from date input (hybrid text +
 *        Today + 📅 calendar pattern from the operator's TAXI-602 polish).
 * Below: history table sorted effective_from DESC, with the active row
 *        editable (clicking Edit prefills the form).
 *
 * Role gating: owner + operator see the form + Save; accountant + viewer
 * see read-only forms (matching the customer/rate/vehicle gates).
 */

interface CustomerRow {
  id: number;
  name: string;
  company_name: string | null;
  state: string;
  is_active: boolean;
}

interface CompanyRow {
  id: number;
  name: string;
  state: string;
}

interface GstConfigRow {
  id: number;
  is_interstate: boolean;
  igst_rate: number | null;
  cgst_rate: number | null;
  sgst_rate: number | null;
  effective_from: string;
  effective_to: string | null;
  status: 'Active' | 'Closed';
  is_active: boolean;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function GstManagementPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [igst, setIgst] = useState<string>('');
  const [cgst, setCgst] = useState<string>('');
  const [sgst, setSgst] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayISO());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const dateInputRef = useRef<HTMLInputElement>(null);

  // -- queries ---------------------------------------------------------------
  const customersQuery = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as CustomerRow[];
    },
  });
  const companyQuery = useQuery({
    queryKey: ['rpc', 'get_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('get_company');
      if (e) throw e;
      const rows = (data ?? []) as CompanyRow[];
      return rows[0] ?? null;
    },
  });
  const gstQuery = useQuery({
    queryKey: ['rpc', 'list_gst_configs_for_customer', selectedCustomerId === '' ? 'none' : selectedCustomerId],
    enabled: selectedCustomerId !== '',
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_gst_configs_for_customer', { p_customer_id: selectedCustomerId });
      if (e) throw e;
      return (data ?? []) as GstConfigRow[];
    },
  });

  const activeCustomers = useMemo(
    () => (customersQuery.data ?? []).filter((c) => c.is_active),
    [customersQuery.data],
  );
  const selectedCustomer = activeCustomers.find((c) => c.id === selectedCustomerId) ?? null;
  const activeRow = (gstQuery.data ?? []).find((r) => r.status === 'Active') ?? null;

  // Auto-reset the form when the customer changes (unless we're editing
  // a specific row that was just saved).
  useEffect(() => {
    if (!selectedCustomer || !companyQuery.data) {
      setIgst(''); setCgst(''); setSgst('');
      setEditingId(null);
      return;
    }
    if (activeRow) {
      setIgst(activeRow.igst_rate == null ? '' : String(activeRow.igst_rate));
      setCgst(activeRow.cgst_rate == null ? '' : String(activeRow.cgst_rate));
      setSgst(activeRow.sgst_rate == null ? '' : String(activeRow.sgst_rate));
      setEditingId(activeRow.id);
    } else {
      setIgst(''); setCgst(''); setSgst('');
      setEditingId(null);
    }
  }, [selectedCustomerId, activeRow?.id, companyQuery.data?.state]);  // eslint-disable-line react-hooks/exhaustive-deps

  // -- derived display --------------------------------------------------------
  const summary = (() => {
    if (!selectedCustomer || !companyQuery.data) return null;
    const isInterstate = selectedCustomer.state !== companyQuery.data.state;
    const kind = isInterstate ? 'IGST applies' : 'CGST + SGST apply';
    return {
      isInterstate,
      kind,
      message: `Customer is in ${selectedCustomer.state}, your company is in ${companyQuery.data.state}, therefore ${kind}.`,
    };
  })();

  // -- mutations -------------------------------------------------------------
  const numOrNull = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const handleSave = async () => {
    if (!selectedCustomer) return;
    setError(null);
    const payload = {
      p_customer_id:    selectedCustomer.id,
      p_igst_rate:      summary?.isInterstate ? numOrNull(igst) : null,
      p_cgst_rate:      summary?.isInterstate ? null : numOrNull(cgst),
      p_sgst_rate:      summary?.isInterstate ? null : numOrNull(sgst),
      p_effective_from: effectiveFrom,
    };
    setBusy(true);
    const rpcErr = editingId
      ? (await supabase.rpc('update_gst_config', {
          p_id: editingId,
          p_igst_rate: payload.p_igst_rate,
          p_cgst_rate: payload.p_cgst_rate,
          p_sgst_rate: payload.p_sgst_rate,
        })).error
      : (await supabase.rpc('add_gst_config', payload)).error;
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setActionNotice(editingId ? 'GST config updated.' : 'GST config saved.');
    setTimeout(() => setActionNotice(null), 2000);
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_gst_configs_for_customer'] });
  };

  const handleEditClick = (row: GstConfigRow) => {
    setEditingId(row.id);
    setIgst(row.igst_rate == null ? '' : String(row.igst_rate));
    setCgst(row.cgst_rate == null ? '' : String(row.cgst_rate));
    setSgst(row.sgst_rate == null ? '' : String(row.sgst_rate));
    setEffectiveFrom(row.effective_from);
    setError(null);
    // Visual feedback: scroll the form into view and focus the first
    // editable input. Without this, clicking Edit on the active row
    // looks like nothing happens (the form was already populated by
    // the auto-populate useEffect above).
    requestAnimationFrame(() => {
      const el = document.getElementById('gst-edit-anchor');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstInput = el.querySelector<HTMLInputElement>(
          'input:not([disabled]):not([type=hidden])',
        );
        firstInput?.focus();
      }
    });
  };

  const openCalendar = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
    el.click();
  };

  // -- render ----------------------------------------------------------------
  return (
    <main className="app-main">
      <Link to="/master" className="back-link">← Back to Master</Link>
      <h1 className="page-title">
        GST Management <span className="page-title__accent">— Master</span>
      </h1>
      <p className="page-subtitle">
        Per-customer GST rates (IGST for interstate, CGST + SGST for intra-state).
        The <code>is_interstate</code> flag is auto-derived from the customer's
        vs company's state — the operator never sets it manually.
      </p>

      {/* Customer picker */}
      <section className="card card--accent" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>Select customer</h3>
        <div className="form-field" style={{ minWidth: '260px', maxWidth: '480px' }}>
          <label htmlFor="gst-customer">Customer</label>
          <select
            id="gst-customer"
            value={selectedCustomerId === '' ? '' : String(selectedCustomerId)}
            onChange={(e) => setSelectedCustomerId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">-- select a customer --</option>
            {activeCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.company_name ? ` (${c.company_name})` : ''} — {c.state}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Summary banner + form */}
      {selectedCustomer && summary && companyQuery.data && (
        <section className="card" id="gst-edit-anchor" style={{ marginBottom: '1.5rem' }}>
          <div
            data-testid="gst-summary"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem',
              background: summary.isInterstate ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
              border: `1px solid ${summary.isInterstate ? 'rgba(245, 158, 11, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
              color: summary.isInterstate ? 'var(--color-warning)' : 'var(--color-success)',
              fontWeight: 500,
            }}
          >
            {summary.message}
          </div>

          {actionNotice && (
            <div className="form-message form-message--ok" role="status" style={{ marginBottom: '0.5rem' }}>
              {actionNotice}
            </div>
          )}
          {error && (
            <div className="form-error form-error--server" role="alert" style={{ marginBottom: '0.5rem' }}>
              {error}
            </div>
          )}

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>GST rates</legend>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ width: '160px' }}>
                <label htmlFor="gst-igst">IGST (%)</label>
                <input
                  id="gst-igst"
                  type="text"
                  inputMode="decimal"
                  value={igst}
                  onChange={(e) => setIgst(e.target.value)}
                  disabled={!summary.isInterstate || !canEdit}
                  placeholder={summary.isInterstate ? 'e.g. 5' : 'n/a (intra-state)'}
                  style={!summary.isInterstate ? { opacity: 0.5 } : undefined}
                />
              </div>
              <div className="form-field" style={{ width: '160px' }}>
                <label htmlFor="gst-cgst">CGST (%)</label>
                <input
                  id="gst-cgst"
                  type="text"
                  inputMode="decimal"
                  value={cgst}
                  onChange={(e) => setCgst(e.target.value)}
                  disabled={summary.isInterstate || !canEdit}
                  placeholder={summary.isInterstate ? 'n/a (interstate)' : 'e.g. 2.5'}
                  style={summary.isInterstate ? { opacity: 0.5 } : undefined}
                />
              </div>
              <div className="form-field" style={{ width: '160px' }}>
                <label htmlFor="gst-sgst">SGST (%)</label>
                <input
                  id="gst-sgst"
                  type="text"
                  inputMode="decimal"
                  value={sgst}
                  onChange={(e) => setSgst(e.target.value)}
                  disabled={summary.isInterstate || !canEdit}
                  placeholder={summary.isInterstate ? 'n/a (interstate)' : 'e.g. 2.5'}
                  style={summary.isInterstate ? { opacity: 0.5 } : undefined}
                />
              </div>
              <div className="form-field" style={{ width: '220px' }}>
                <label htmlFor="gst-from">Effective from (YYYY-MM-DD)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    id="gst-from"
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY-MM-DD"
                    pattern="\d{4}-\d{2}-\d{2}"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    disabled={!canEdit}
                    required
                    style={{ flex: 1 }}
                  />
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setEffectiveFrom(todayISO())}
                        data-testid="gst-today-btn"
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={openCalendar}
                        data-testid="gst-calendar-btn"
                        aria-label="Pick date from calendar"
                        title="Pick date from calendar"
                        style={{ padding: '0.45rem 0.7rem', fontSize: '1rem' }}
                      >
                        📅
                      </button>
                      <input
                        ref={dateInputRef}
                        type="date"
                        value={effectiveFrom}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEffectiveFrom(e.target.value)}
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{
                          position: 'absolute', width: '1px', height: '1px',
                          padding: 0, margin: '-1px', overflow: 'hidden',
                          clip: 'rect(0,0,0,0)', border: 0,
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {canEdit && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn--primary" onClick={handleSave} disabled={busy}>
                  {busy ? (
                    <><span className="loading__spinner" aria-hidden="true" />Saving…</>
                  ) : editingId ? 'Save changes' : 'Save'}
                </button>
              </div>
            )}
            {/*
              Note (operator-requested, TAXI-702): GST edits now use
              in-place UPDATE (update_gst_config RPC), not time-travel.
              The history table below will continue to show all rows but
              new rows are no longer auto-created on edits. Rates
              (master.rates) keep their time-travel behavior.
            */}
          </fieldset>
        </section>
      )}

      {/* History table */}
      {selectedCustomerId !== '' && (
        <section className="card">
          <h3 style={{ margin: '0 0 0.5rem' }}>GST config history</h3>
          {gstQuery.isLoading ? (
            <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading…</div>
          ) : gstQuery.isError ? (
            <div className="form-error form-error--server" role="alert">
              Failed to load: {gstQuery.error instanceof Error ? gstQuery.error.message : 'unknown error'}
            </div>
          ) : !gstQuery.data || gstQuery.data.length === 0 ? (
            <p data-testid="gst-empty">No GST config yet for this customer.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Effective from</th>
                    <th>Effective to</th>
                    <th>is_interstate</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>Status</th>
                    {canEdit && <th style={{ width: '120px' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {gstQuery.data.map((r) => (
                    <tr key={r.id} className={r.status === 'Closed' ? 'data-table__row--inactive' : ''} data-testid={`gst-row-${r.id}`}>
                      <td>{r.effective_from}</td>
                      <td>{r.effective_to ?? '— (current)'}</td>
                      <td>{r.is_interstate ? 'Yes' : 'No'}</td>
                      <td>{r.igst_rate == null ? '—' : r.igst_rate}</td>
                      <td>{r.cgst_rate == null ? '—' : r.cgst_rate}</td>
                      <td>{r.sgst_rate == null ? '—' : r.sgst_rate}</td>
                      <td>{r.status}</td>
                      {canEdit && (
                        <td>
                          {r.status === 'Active' ? (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => handleEditClick(r)}
                              data-testid={`gst-edit-${r.id}`}
                            >
                              Edit
                            </button>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>closed</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
