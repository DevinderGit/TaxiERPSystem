/**
 * BillRegisterReport — M13 / TAXI-1302.
 *
 * Two-pane report at `/reports/bill-register`:
 *
 *   Left pane:  filterable list of bills (date range, customer, status).
 *              Click a row to load it in the right pane.
 *
 *   Right pane: full HTML preview of the selected bill — mirrors the
 *              BillPDF layout 1:1. Print Bill button opens the M11
 *              BillPDF in a new tab.
 *
 * REWRITE NOTE (2026-09-23): stripped down to a guaranteed-renders
 * baseline. The two-pane layout, detail preview, and PDF print are
 * all wired but the JSX was simplified to isolate any rendering
 * bugs the operator saw ("nothing happens" on click).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { fetchData, getBlobURL, revokeBlobURL } from '../../services/PdfTemplateFactory';
import type { BillPDFData } from '../../templates/pdf/BillPDF';
import { useBillCoverQuery } from '../../hooks/useBillCoverData';

const REPORT_NAV_LINKS = [
  { to: '/reports/bill-cover',     label: 'Bill Cover'     },
  { to: '/reports/bill-register',  label: 'Bill Register'  },
  { to: '/reports/duty-register',  label: 'Duty Register'  },
] as const;

const navLinkStyle: React.CSSProperties = {
  padding: '0.45rem 0.85rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-muted)',
  fontWeight: 500,
  fontSize: '0.9rem',
  textDecoration: 'none',
};

const backLinkStyle: React.CSSProperties = {
  color: 'var(--color-accent)',
  textDecoration: 'none',
  fontSize: '0.85rem',
};

export function BillRegisterReport() {
  const { companyId } = useAuth();
  const coverQuery = useBillCoverQuery(companyId);

  // Deep-link support: /reports/bill-register?bill_no=BL-XXXX
  // auto-selects the bill on mount so callers from the Duty
  // Register Report (or any external link) land on the detail
  // immediately.
  const [searchParams] = useSearchParams();
  const deepLinkBillNo = searchParams.get('bill_no')?.trim() || null;

  const [customerFilter, setCustomerFilter] = useState<string>('');
  const [statusFilter,   setStatusFilter]   = useState<string>('all');
  const [fromDate,        setFromDate]       = useState<string>('');
  const [toDate,          setToDate]         = useState<string>('');

  const [selectedBillNo, setSelectedBillNo] = useState<string | null>(
    deepLinkBillNo,
  );
  const [detail,         setDetail]         = useState<BillPDFData | null>(null);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [detailError,    setDetailError]    = useState<string | null>(null);

  const customerOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of coverQuery.data ?? []) {
      if (map.has(r.customer_id)) continue;
      const label = r.customer_company_name
        ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
        : (r.customer_name ?? '—');
      map.set(r.customer_id, label);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [coverQuery.data]);

  const filteredEntries = useMemo(() => {
    const all = coverQuery.data ?? [];
    return all.filter((r) => {
      if (customerFilter && String(r.customer_id) !== customerFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (fromDate && r.bill_date < fromDate) return false;
      if (toDate   && r.bill_date > toDate)   return false;
      return true;
    });
  }, [coverQuery.data, customerFilter, statusFilter, fromDate, toDate]);

  useEffect(() => {
    if (!selectedBillNo) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    fetchData('bill', selectedBillNo)
      .then((data) => setDetail(data as BillPDFData))
      .catch((e: unknown) => {
        setDetailError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setDetailLoading(false));
  }, [selectedBillNo]);

  // Clear the ?bill_no= param from the URL after first apply so
  // the back/forward buttons don't keep reopening the same bill.
  // Keep it simple — only strip if it was present.
  useEffect(() => {
    if (!deepLinkBillNo) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('bill_no');
      const newSearch = next.toString();
      window.history.replaceState(
        null,
        '',
        newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname,
      );
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="app-main" data-testid="br-page">
      <p style={{ margin: '0 0 0.5rem' }}>
        <Link to="/reports" style={backLinkStyle}>← Back to Reports</Link>
      </p>
      <h1 className="page-title">
        Bill Register <span className="page-title__accent">Report</span>
      </h1>
      <p className="page-subtitle">
        Two-pane bill browser. Pick a bill on the left, view its full
        breakdown on the right, print to PDF when ready.
      </p>

      <nav
        className="sub-nav"
        aria-label="Report sections"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        {REPORT_NAV_LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} style={navLinkStyle}>
            {l.label}
          </NavLink>
        ))}
      </nav>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) 1fr',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        {/* LEFT PANE */}
        <div>
          <div className="card" style={{ marginBottom: '0.75rem' }}>
            <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.95rem' }}>Filter</h3>

            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.2rem' }}>
                Customer
              </label>
              <select
                data-testid="br-customer"
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                style={filterControlStyle}
              >
                <option value="">All</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.2rem' }}>
                Status
              </label>
              <select
                data-testid="br-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={filterControlStyle}
              >
                <option value="all">All</option>
                <option value="issued">Issued</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.2rem' }}>
                  From
                </label>
                <input
                  type="date"
                  data-testid="br-from"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  style={filterControlStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.2rem' }}>
                  To
                </label>
                <input
                  type="date"
                  data-testid="br-to"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  style={filterControlStyle}
                />
              </div>
            </div>

            <button
              type="button"
              data-testid="br-clear"
              onClick={() => {
                setCustomerFilter('');
                setStatusFilter('all');
                setFromDate('');
                setToDate('');
              }}
              style={secondaryBtnStyle}
            >
              Clear filters
            </button>
          </div>

          {/* Bill list */}
          <div
            className="card"
            style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}
          >
            <div
              style={{
                padding: '0.6rem 0.75rem',
                background: '#1f1f24',
                color: '#facc15',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderBottom: '1px solid #2a2a30',
              }}
            >
              {filteredEntries.length} bill(s)
            </div>

            {coverQuery.isLoading ? (
              <p style={listEmptyStyle}>Loading…</p>
            ) : coverQuery.isError ? (
              <p style={{ ...listEmptyStyle, color: '#f87171' }}>
                Failed: {(coverQuery.error as Error).message}
              </p>
            ) : filteredEntries.length === 0 ? (
              <p style={listEmptyStyle}>No bills match.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {filteredEntries.map((r) => {
                  const isSelected = r.bill_no === selectedBillNo;
                  const isCancelled = r.status === 'cancelled';
                  return (
                    <li
                      key={r.bill_id}
                      data-testid={`br-row-${r.bill_no}`}
                      onClick={() => setSelectedBillNo(r.bill_no)}
                      style={{
                        padding: '0.55rem 0.75rem',
                        borderBottom: '1px solid #2a2a30',
                        cursor: 'pointer',
                        background: isSelected ? '#fffbeb' : 'transparent',
                        color: isSelected ? '#0c0c0e' : '#f5f5f7',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                        <strong style={{
                          textDecoration: isCancelled ? 'line-through' : 'none',
                          color: isCancelled && !isSelected ? '#fca5a5' : 'inherit',
                        }}>
                          {r.bill_no}
                        </strong>
                        <span style={{ fontSize: '0.78rem', color: isSelected ? '#4b5563' : '#9ca3af' }}>
                          {fmtDate(r.bill_date)}
                        </span>
                      </div>
                      <div style={{
                        fontSize: '0.85rem',
                        marginTop: 2,
                        textDecoration: isCancelled ? 'line-through' : 'none',
                        color: isCancelled && !isSelected ? '#fca5a5' : 'inherit',
                      }}>
                        {r.customer_company_name
                          ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
                          : (r.customer_name ?? '—')}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        marginTop: 2,
                        color: isSelected ? '#0c0c0e' : '#facc15',
                        fontWeight: 600,
                      }}>
                        ₹{fmtNum(r.grand_total)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT PANE */}
        <div className="card">
          {!selectedBillNo ? (
            <p style={{ color: '#9ca3af', margin: 0 }}>
              Select a bill on the left to view its full breakdown.
            </p>
          ) : detailLoading ? (
            <p style={{ color: '#9ca3af', margin: 0 }}>Loading bill {selectedBillNo}…</p>
          ) : detailError ? (
            <p style={{ color: '#f87171', margin: 0 }}>{detailError}</p>
          ) : detail ? (
            <BillPreview data={detail} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------
// Bill HTML preview
// ------------------------------------------------------------------

function BillPreview({ data }: { data: BillPDFData }) {
  const isInterstate = data.gst?.is_interstate === true;
  return (
    <div data-testid="br-detail">
      {/* Header + Print button */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{data.bill_no}</h2>
          <p style={{ margin: '0.2rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }}>
            Bill Date: {fmtDate(data.bill_date)}{' • '}
            <span style={statusBadgeStyle(data.status)}>
              {data.status.toUpperCase()}
            </span>
          </p>
        </div>
        <PrintBillButton billNo={data.bill_no} />
      </div>

      {/* Company header */}
      <Section title="INVOICE">
        <div style={{ textAlign: 'center', marginBottom: '0.5rem', fontSize: '1.05rem', fontWeight: 700 }}>
          {data.company.name}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '0.75rem',
          fontSize: '0.82rem',
        }}>
          <div>
            <KV label="GSTIN."    value={data.company.gstin} />
            <KV label="SAC NO."   value={data.company.sac_no} />
            <KV label="PAN NO."   value={data.company.pan} />
            <KV label="STATE CODE" value={data.company.state_code} />
            <KV label="S.T.Ctgry"  value={data.company.st_category} />
          </div>
          <div>
            {data.company.address_line1 ? <div>{data.company.address_line1}</div> : null}
            {data.company.address_line2 ? <div>{data.company.address_line2}</div> : null}
            <div>
              {[data.company.city, data.company.state, data.company.pincode].filter(Boolean).join(', ')}
            </div>
            {data.company.email ? <div style={{ marginTop: '0.4rem' }}>Email: {data.company.email}</div> : null}
          </div>
          <div style={{ textAlign: 'right' }}>
            {data.company.phone ? <div>Contact: {data.company.phone}</div> : null}
            <div style={{ marginTop: '0.4rem', color: '#9ca3af', fontSize: '0.78rem' }}>Bill No.</div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{data.bill_no}</div>
            <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Bill Date</div>
            <div>{fmtDate(data.bill_date)}</div>
          </div>
        </div>
      </Section>

      {/* Customer */}
      <Section title="BILL TO">
        <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>
          {data.customer.company_name || data.customer.name}
        </div>
        {data.customer.company_name ? (
          <div style={{ fontSize: '0.82rem', color: '#9ca3af' }}>
            Attn: {data.customer.name}
          </div>
        ) : null}
        <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
          {[
            data.customer.address_line1,
            data.customer.address_line2,
            [data.customer.city, data.customer.state, data.customer.pincode].filter(Boolean).join(', '),
          ].filter(Boolean).join(', ') || '—'}
        </div>
        {data.customer.gstin ? (
          <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>GSTIN: {data.customer.gstin}</div>
        ) : null}
      </Section>

      {/* Duty slips */}
      <Section title={`DUTY SLIPS (${data.duty_slips.length})`}>
        {data.duty_slips.length === 0 ? (
          <p style={{ color: '#9ca3af', margin: 0 }}>No duty slips linked.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Slip No</th>
                <th style={th}>Date</th>
                <th style={th}>Vehicle</th>
                <th style={{ ...th, textAlign: 'right' }}>KM</th>
                <th style={{ ...th, textAlign: 'right' }}>Hrs</th>
                <th style={{ ...th, textAlign: 'right' }}>Base (₹)</th>
                <th style={{ ...th, textAlign: 'right' }}>Extras (₹)</th>
                <th style={{ ...th, textAlign: 'right' }}>Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              {data.duty_slips.map((r, i) => {
                const extras =
                  Number(r.extra_km_amount ?? 0) +
                  Number(r.extra_hour_amount ?? 0) +
                  Number(r.night_halt_amount ?? 0) +
                  Number(r.driver_allowance ?? 0) +
                  Number(r.other_charges ?? 0);
                return (
                  <tr key={r.duty_slip_no + i}>
                    <td style={td}>{r.duty_slip_no}</td>
                    <td style={td}>{fmtDate(r.booking_date)}</td>
                    <td style={td}>{r.vehicle_reg_no ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.total_km != null ? fmtInt(r.total_km) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.total_hours != null ? fmtNum(r.total_hours, 1) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(r.base_amount)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtNum(extras)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtNum(r.total_amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Totals */}
      <Section>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 280 }}>
            <TotalsLine label="TOTAL AMOUNT" value={`₹ ${fmtNum(data.base_amount + data.extra_amount)}`} />
            {isInterstate ? (
              <TotalsLine
                label={`IGST ( @ ${fmtNum(data.gst?.igst_rate ?? 0, 2)} % )`}
                value={`₹ ${fmtNum(data.igst_amount)}`}
                band
              />
            ) : (
              <>
                <TotalsLine
                  label={`CGST ( @ ${fmtNum(data.gst?.cgst_rate ?? 0, 2)} % )`}
                  value={`₹ ${fmtNum(data.cgst_amount)}`}
                  band
                />
                <TotalsLine
                  label={`SGST ( @ ${fmtNum(data.gst?.sgst_rate ?? 0, 2)} % )`}
                  value={`₹ ${fmtNum(data.sgst_amount)}`}
                  band
                />
              </>
            )}
            {data.parking_toll_total > 0 ? (
              <>
                <div style={{ height: 6 }} />
                <TotalsLine label="" value={`₹ ${fmtNum(data.parking_toll_total)}`} band />
                <div style={{
                  fontSize: '0.78rem',
                  color: '#6b7280',
                  fontStyle: 'italic',
                  paddingLeft: 4,
                  paddingBottom: 4,
                }}>
                  Parking/TollTax Detail
                </div>
              </>
            ) : null}
            <TotalsLine
              label="NET AMOUNT"
              value={`₹ ${fmtNum(data.grand_total)}`}
              big
            />
          </div>
        </div>
      </Section>

      {/* Signature */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem',
      }}>
        <div style={{
          width: 220, textAlign: 'center',
          borderTop: '1px solid #f5f5f7', paddingTop: 4,
        }}>
          <div style={{ fontWeight: 700 }}>For {data.company.name}</div>
          <div style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Authorized Signatory</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Print Bill button — opens the M11 BillPDF in a new tab via factory.
// ------------------------------------------------------------------

function PrintBillButton({ billNo }: { billNo: string }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const data = (await fetchData('bill', billNo)) as BillPDFData;
      const url  = await getBlobURL('bill', data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => revokeBlobURL(url), 5 * 60 * 1000);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
      <button
        type="button"
        data-testid="br-print"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: '0.5rem 0.9rem',
          borderRadius: 6,
          background: '#facc15',
          color: '#0c0c0e',
          border: 'none',
          fontWeight: 700,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Generating…' : '🖨 Print Bill'}
      </button>
      {err ? (
        <span style={{ fontSize: '0.78rem', color: '#f87171', maxWidth: 240 }}>{err}</span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// Local helpers
// ------------------------------------------------------------------

function Section({
  title, children,
}: { title?: string; children: React.ReactNode }) {
  return (
    <div style={sectionBoxStyle}>
      {title ? <h3 style={sectionTitleStyle}>{title}</h3> : null}
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ fontSize: '0.82rem', marginBottom: 2 }}>
      <span style={{ fontWeight: 700 }}>{label} </span>
      <span>{value ?? '—'}</span>
    </div>
  );
}

function TotalsLine({
  label, value, band = false, big = false,
}: { label: string; value: string; band?: boolean; big?: boolean }) {
  // When the row has a light-yellow background (band or big), force
  // dark text — otherwise the page's light text colour inherits and
  // becomes invisible on the cream background.
  const hasLightBg = band || big;
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '0.25rem 0.5rem',
      background: big ? '#fffbeb' : (band ? '#fff7ed' : 'transparent'),
      color: hasLightBg ? '#0c0c0e' : 'inherit',
      fontWeight: big ? 700 : 600,
      fontSize: big ? '1rem' : '0.85rem',
      borderTop: big ? '2px solid #facc15' : 'none',
    }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function statusBadgeStyle(s: string): React.CSSProperties {
  switch (s) {
    case 'issued':    return { padding: '0.1rem 0.45rem', borderRadius: 4, background: '#dcfce7', color: '#166534', fontSize: '0.75rem', fontWeight: 700 };
    case 'cancelled': return { padding: '0.1rem 0.45rem', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontSize: '0.75rem', fontWeight: 700 };
    default:          return { padding: '0.1rem 0.45rem', borderRadius: 4, background: '#fef3c7', color: '#854d0e', fontSize: '0.75rem', fontWeight: 700 };
  }
}

// ----- styles -----

const filterControlStyle: React.CSSProperties = {
  padding: '0.4rem 0.55rem',
  background: 'transparent',
  color: '#f5f5f7',
  border: '1px solid #2a2a30',
  borderRadius: 6,
  width: '100%',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  borderRadius: 6,
  background: 'transparent',
  color: '#facc15',
  border: '1px solid #facc15',
  fontWeight: 600,
  cursor: 'pointer',
};

const sectionBoxStyle: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#2a2a30',
  borderRadius: 6,
  padding: '0.75rem',
  marginBottom: '0.75rem',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 0.5rem 0',
  fontSize: '0.78rem',
  fontWeight: 700,
  background: '#fffbeb',
  color: '#0c0c0e',
  padding: '0.2rem 0.5rem',
  borderRadius: 4,
  display: 'inline-block',
};

const listEmptyStyle: React.CSSProperties = {
  padding: '0.75rem',
  color: '#9ca3af',
  margin: 0,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.82rem',
};

const th: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 700,
  background: '#1f1f24',
  color: '#facc15',
  borderBottom: '1px solid #2a2a30',
};

const td: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #2a2a30',
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function fmtNum(n: number | null | undefined, decimals = 2): string {
  return Number(n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
