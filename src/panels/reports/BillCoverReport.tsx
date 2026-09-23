/**
 * BillCoverReport — M13 / TAXI-1301.
 *
 * Read-only summary report at `/reports/bill-cover`. Filter bar:
 * customer name search, guest_name substring search, date range.
 * Table: bill_no | date | customer | guest | slip-count | base+extra
 *        | tax | amount | status.
 *
 * Per the spec: "Reports panel is read-only for all roles including
 * viewer" — no write actions on this page. Role gating is handled
 * in AppRouter.
 *
 * The Print button generates the BillCoverReportPDF via
 * @react-pdf/renderer client-side and opens it in a new tab.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import {
  filterBillCover,
  totalGrand,
  useBillCoverQuery,
  type BillCoverEntry,
  type BillCoverFilters,
} from '../../hooks/useBillCoverData';
import { BillCoverReportPDF } from '../../templates/pdf/BillCoverReportPDF';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function BillCoverReport() {
  const { companyId } = useAuth();
  const query = useBillCoverQuery(companyId);

  const [customerName, setCustomerName] = useState<string>('');
  const [guestName,    setGuestName]    = useState<string>('');
  const [fromDate,      setFromDate]     = useState<string>('');
  const [toDate,        setToDate]       = useState<string>('');

  const [appliedFilters, setAppliedFilters] = useState<BillCoverFilters>({
    customerName: '',
    guestName: '',
    fromDate: '',
    toDate: '',
  });
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  const [printing,     setPrinting]     = useState(false);
  const [printError,   setPrintError]   = useState<string | null>(null);

  const allEntries = useMemo<BillCoverEntry[]>(
    () => query.data ?? [],
    [query.data],
  );

  const filteredEntries = useMemo(
    () => filterBillCover(allEntries, appliedFilters),
    [allEntries, appliedFilters],
  );
  const total = useMemo(() => totalGrand(filteredEntries), [filteredEntries]);

  const handleApply = () => {
    if (fromDate && toDate && fromDate > toDate) {
      window.alert('From date must be ≤ To date.');
      return;
    }
    setAppliedFilters({
      customerName: customerName.trim(),
      guestName: guestName.trim(),
      fromDate,
      toDate,
    });
    setHasSearched(true);
  };

  const handleClear = () => {
    setCustomerName('');
    setGuestName('');
    setFromDate('');
    setToDate('');
    setAppliedFilters({ customerName: '', guestName: '', fromDate: '', toDate: '' });
    setHasSearched(false);
  };

  const handlePrint = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    setPrintError(null);
    try {
      // Fetch the company row directly so the PDF header is right
      // even if the bill list is empty. The RPCs only carry company
      // columns when at least one bill exists — for a brand-new
      // company we'd fall back to empty strings. Not a concern in
      // practice for a report that's only useful after bills exist.
      const company = await fetchCompanyForReport(companyId);

      const blob = await pdf(
        <BillCoverReportPDF
          data={{
            company,
            filters: appliedFilters,
            generatedAt: new Date().toISOString(),
            entries: filteredEntries,
            total,
          }}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrintError(`Print failed: ${msg}`);
    } finally {
      setPrinting(false);
    }
  }, [printing, appliedFilters, filteredEntries, total, companyId]);

  return (
    <main className="app-main">
      <p style={{ margin: '0 0 0.5rem' }}>
        <Link
          to="/reports"
          style={{ color: 'var(--color-accent)', textDecoration: 'none', fontSize: '0.85rem' }}
        >
          ← Back to Reports
        </Link>
      </p>
      <h1 className="page-title">
        Bill Cover <span className="page-title__accent">Report</span>
      </h1>
      <p className="page-subtitle">
        Read-only summary of every bill with customer + duty-slip
        aggregates. Filter by customer, guest, or date range, then
        print to PDF.
      </p>

      <nav
        className="sub-nav"
        aria-label="Report sections"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}
      >
        {[
          { to: '/reports/bill-cover',    label: 'Bill Cover'    },
          { to: '/reports/bill-register', label: 'Bill Register' },
        ].map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            style={{
              padding: '0.45rem 0.85rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
              color: 'var(--color-text-muted)',
              fontWeight: 500,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>

      {/* ===== Filter bar ===== */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field
            label="Customer Name"
            input={
              <input
                type="text"
                data-testid="bill-cover-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
                placeholder="e.g. Acme"
                style={inputStyle}
              />
            }
          />
          <Field
            label="Guest Name"
            input={
              <input
                type="text"
                data-testid="bill-cover-guest"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
                placeholder="e.g. John"
                style={inputStyle}
              />
            }
          />
          <Field
            label="From Date"
            input={
              <input
                type="date"
                data-testid="bill-cover-from"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={inputStyle}
              />
            }
          />
          <Field
            label="To Date"
            input={
              <input
                type="date"
                data-testid="bill-cover-to"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={inputStyle}
              />
            }
          />

          <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
            <button
              type="button"
              data-testid="bill-cover-search"
              onClick={handleApply}
              style={primaryBtnStyle}
            >
              Search
            </button>
            <button
              type="button"
              data-testid="bill-cover-clear"
              onClick={handleClear}
              style={secondaryBtnStyle}
            >
              Clear
            </button>
            <button
              type="button"
              data-testid="bill-cover-print"
              onClick={() => void handlePrint()}
              disabled={printing}
              style={{
                ...secondaryBtnStyle,
                cursor: printing ? 'wait' : 'pointer',
                opacity: printing ? 0.6 : 1,
              }}
            >
              {printing ? 'Generating…' : '🖨 Print'}
            </button>
          </div>
        </div>

        {printError ? (
          <p
            data-testid="bill-cover-print-error"
            style={{ marginTop: '0.5rem', color: '#f87171', fontWeight: 600 }}
          >
            {printError}
          </p>
        ) : null}
      </div>

      {/* ===== Table (hidden until first Search, per operator UX request) ===== */}
      {!hasSearched ? (
        <div className="card">
          <p style={{ color: '#9ca3af' }}>
            Set filters above and click{' '}
            <strong style={{ color: '#facc15' }}>Search</strong>{' '}
            to view the bill cover.
          </p>
        </div>
      ) : (
        <>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#9ca3af',
              marginBottom: '0.5rem',
            }}
          >
            Showing <strong>{filteredEntries.length}</strong> of{' '}
            <strong>{allEntries.length}</strong> bill(s).
            Grand total: <strong>₹{total.toFixed(2)}</strong>.
          </p>

          {query.isLoading ? (
            <div className="card"><p style={{ color: '#9ca3af' }}>Loading…</p></div>
          ) : query.isError ? (
            <div className="card">
              <p style={{ color: '#f87171' }}>
                Failed to load: {(query.error as Error).message}
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="card">
              <p style={{ color: '#9ca3af' }}>
                No bills match the current filters. Try a wider range or click Clear.
              </p>
            </div>
          ) : (
            <BillCoverTable entries={filteredEntries} />
          )}
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------
// Table component
// ------------------------------------------------------------------

function BillCoverTable({ entries }: { entries: BillCoverEntry[] }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', color: '#f5f5f7' }}>
        <thead>
          <tr style={{ background: '#1f1f24', color: '#facc15' }}>
            <th style={th}>Bill No</th>
            <th style={th}>Date</th>
            <th style={th}>Customer</th>
            <th style={th}>Guest</th>
            <th style={{ ...th, textAlign: 'right' }}>Slips</th>
            <th style={{ ...th, textAlign: 'right' }}>Base+Ext (₹)</th>
            <th style={{ ...th, textAlign: 'right' }}>Tax (₹)</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount (₹)</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((r, i) => (
            <tr
              key={r.bill_id}
              style={{ background: i % 2 === 1 ? '#16161a' : 'transparent' }}
            >
              <td style={td}>{r.bill_no}</td>
              <td style={td}>{fmtDate(r.bill_date)}</td>
              <td style={td}>
                {r.customer_company_name
                  ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
                  : (r.customer_name ?? '—')}
              </td>
              <td style={td}>{r.guest_names || '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.duty_slip_count}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                {fmtNum(r.base_amount + r.extra_amount)}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>{fmtNum(r.total_tax)}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                {fmtNum(r.grand_total)}
              </td>
              <td style={td}>
                <span style={statusBadgeStyle(r.status)}>
                  {r.status.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function Field({ label, input }: { label: string; input: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{label}</span>
      {input}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.6rem',
  background: 'transparent',
  color: '#f5f5f7',
  border: '1px solid #2a2a30',
  borderRadius: 6,
  minWidth: 140,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: 6,
  background: '#facc15',
  color: '#0c0c0e',
  border: 'none',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '0.45rem 0.9rem',
  borderRadius: 6,
  background: 'transparent',
  color: '#facc15',
  border: '1px solid #facc15',
  fontWeight: 600,
  cursor: 'pointer',
};

const th: React.CSSProperties = {
  padding: '0.55rem 0.6rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 600,
  borderBottom: '1px solid #2a2a30',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #2a2a30',
  whiteSpace: 'nowrap',
};

function fmtDate(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function fmtNum(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusBadgeStyle(s: string): React.CSSProperties {
  switch (s) {
    case 'issued':    return { color: '#86efac', fontWeight: 600 };
    case 'cancelled': return { color: '#fca5a5', fontWeight: 600 };
    default:          return { color: '#facc15', fontWeight: 600 };
  }
}

// ------------------------------------------------------------------
// Company fetch helper — shared with the factory's path
// ------------------------------------------------------------------

async function fetchCompanyForReport(
  companyId: number | null | undefined,
): Promise<{
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  sac_no: string | null;
  state_code: string | null;
  st_category: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logo_data_uri: string | null;
}> {
  // Use list_bills_for_company which carries company_id on every
  // row. If no bills exist yet, fall back to a minimal shape.
  const r = await supabase.rpc('list_bills_for_company');
  if (r.error || !r.data || (r.data as any[]).length === 0) {
    void companyId;
    return {
      name: '', legal_name: null, gstin: null, pan: null,
      sac_no: null, state_code: null, st_category: null,
      address_line1: null, address_line2: null, city: null,
      state: null, pincode: null, phone: null, email: null,
      logo_data_uri: null,
    };
  }
  const r0 = (r.data as any[])[0];
  return {
    name:          String(r0.company_name ?? ''),
    legal_name:    (r0.company_legal_name as string | null) ?? null,
    gstin:         (r0.company_gstin as string | null) ?? null,
    pan:           (r0.company_pan as string | null) ?? null,
    sac_no:        (r0.company_sac_no as string | null) ?? null,
    state_code:    (r0.company_state_code as string | null) ?? null,
    st_category:   (r0.company_st_category as string | null) ?? null,
    address_line1: (r0.company_address_line1 as string | null) ?? null,
    address_line2: (r0.company_address_line2 as string | null) ?? null,
    city:          (r0.company_city as string | null) ?? null,
    state:         (r0.company_state as string | null) ?? null,
    pincode:       (r0.company_pincode as string | null) ?? null,
    phone:         (r0.company_phone as string | null) ?? null,
    email:         (r0.company_email as string | null) ?? null,
    logo_data_uri: null,
  };
}
