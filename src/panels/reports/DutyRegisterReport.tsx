/**
 * DutyRegisterReport — M13 / TAXI-1303.
 *
 * Filterable, sortable duty-slip table at `/reports/duty-register`.
 * Filter bar: customer / vehicle / status / date range.
 * Table columns per spec: duty_slip_no / booking_date / customer /
 *   vehicle / duty_type / total_km / total_hours / total_amount /
 *   bill_no (clickable if billed) / status.
 * Sortable by any column.
 * Print button → DutyRegisterReportPDF via PdfTemplateFactory.
 *
 * Read-only. All four roles (including viewer) can read this.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { useAuth } from '../../hooks/useAuth';
import { revokeBlobURL } from '../../services/PdfTemplateFactory';
import {
  filterDutyRegister,
  sortDutyRegister,
  useDutyRegisterQuery,
  type DutyRegisterEntry,
  type DutyRegisterSortKey,
} from '../../hooks/useDutyRegisterData';
import { DutyRegisterReportPDF } from '../../templates/pdf/DutyRegisterReportPDF';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REPORT_NAV_LINKS = [
  { to: '/reports/bill-cover',     label: 'Bill Cover'     },
  { to: '/reports/bill-register',  label: 'Bill Register'  },
  { to: '/reports/duty-register',  label: 'Duty Register'  },
] as const;

const STATUS_OPTIONS = [
  { value: 'all',       label: 'All'       },
  { value: 'open',      label: 'Open'      },
  { value: 'closed',    label: 'Closed'    },
  { value: 'billed',    label: 'Billed'    },
  { value: 'cancelled', label: 'Cancelled' },
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

const primaryBtnStyle: React.CSSProperties = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  background: '#facc15',
  color: '#0c0c0e',
  border: 'none',
  fontWeight: 700,
  cursor: 'pointer',
};

export function DutyRegisterReport() {
  const { companyId } = useAuth();
  const query = useDutyRegisterQuery(companyId);

  const [customerId, setCustomerId] = useState<string>('');
  const [vehicleId,  setVehicleId]  = useState<string>('');
  const [status,     setStatus]     = useState<string>('all');
  const [fromDate,   setFromDate]   = useState<string>('');
  const [toDate,     setToDate]     = useState<string>('');
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  const [sortKey, setSortKey] = useState<DutyRegisterSortKey>('booking_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [printing, setPrinting] = useState(false);
  const [printErr, setPrintErr] = useState<string | null>(null);

  // ----- Customer dropdown -----
  const customerOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of query.data ?? []) {
      if (map.has(r.customer_id)) continue;
      const label = r.customer_company_name
        ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
        : (r.customer_name ?? '—');
      map.set(r.customer_id, label);
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [query.data]);

  // ----- Vehicle dropdown -----
  const vehicleOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of query.data ?? []) {
      if (r.vehicle_id == null || r.vehicle_reg_no == null) continue;
      if (map.has(r.vehicle_id)) continue;
      map.set(r.vehicle_id, r.vehicle_reg_no);
    }
    return Array.from(map.entries())
      .map(([id, reg]) => ({ id, reg }))
      .sort((a, b) => a.reg.localeCompare(b.reg));
  }, [query.data]);

  // ----- Filtered + sorted -----
  const allEntries = query.data ?? [];
  const filteredEntries = useMemo(
    () => filterDutyRegister(allEntries, {
      customerId, vehicleId, status, fromDate, toDate,
    }),
    [allEntries, customerId, vehicleId, status, fromDate, toDate],
  );
  const sortedEntries = useMemo(
    () => sortDutyRegister(filteredEntries, sortKey, sortDir),
    [filteredEntries, sortKey, sortDir],
  );

  const total = useMemo(
    () => sortedEntries.reduce((acc, r) => acc + Number(r.total_amount ?? 0), 0),
    [sortedEntries],
  );

  const handleApply = () => {
    if (fromDate && toDate && fromDate > toDate) {
      window.alert('From date must be ≤ To date.');
      return;
    }
    setHasSearched(true);
  };

  const handleClear = () => {
    setCustomerId('');
    setVehicleId('');
    setStatus('all');
    setFromDate('');
    setToDate('');
    setHasSearched(false);
  };

  const handleSort = (key: DutyRegisterSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // ----- Print -----
  const handlePrint = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    setPrintErr(null);
    try {
      const company = await fetchCompanyForReportLocal();
      const filters = {
        customerLabel: customerOptions.find((c) => String(c.id) === customerId)?.label ?? '',
        vehicleLabel:  vehicleOptions.find((v) => String(v.id) === vehicleId)?.reg ?? '',
        status,
        fromDate,
        toDate,
      };
      const blob = await pdf(
        <DutyRegisterReportPDF
          data={{
            company,
            filters,
            generatedAt: new Date().toISOString(),
            entries: sortedEntries,
            total,
          }}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => revokeBlobURL(url), 5 * 60 * 1000);
    } catch (e: unknown) {
      setPrintErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPrinting(false);
    }
  }, [printing, customerId, vehicleId, status, fromDate, toDate, sortedEntries, total, customerOptions, vehicleOptions]);

  return (
    <main className="app-main">
      <p style={{ margin: '0 0 0.5rem' }}>
        <Link to="/reports" style={backLinkStyle}>← Back to Reports</Link>
      </p>
      <h1 className="page-title">
        Duty Register <span className="page-title__accent">Report</span>
      </h1>
      <p className="page-subtitle">
        Every duty slip with customer + vehicle + bill number.
        Filter, sort, and print to PDF.
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

      {/* Filter card */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.6rem',
          alignItems: 'flex-end',
        }}>
          <FilterField label="Customer">
            <select
              data-testid="dr-customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              style={filterControlStyle}
            >
              <option value="">All</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>{c.label}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Vehicle">
            <select
              data-testid="dr-vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              style={filterControlStyle}
            >
              <option value="">All</option>
              {vehicleOptions.map((v) => (
                <option key={v.id} value={String(v.id)}>{v.reg}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Status">
            <select
              data-testid="dr-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={filterControlStyle}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </FilterField>

          <FilterField label="From Date">
            <input
              type="date"
              data-testid="dr-from"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={filterControlStyle}
            />
          </FilterField>

          <FilterField label="To Date">
            <input
              type="date"
              data-testid="dr-to"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={filterControlStyle}
            />
          </FilterField>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="dr-search"
            onClick={handleApply}
            style={primaryBtnStyle}
          >
            Search
          </button>
          <button
            type="button"
            data-testid="dr-clear"
            onClick={handleClear}
            style={secondaryBtnStyle}
          >
            Clear
          </button>
          <button
            type="button"
            data-testid="dr-print"
            onClick={() => void handlePrint()}
            disabled={printing}
            style={{
              ...secondaryBtnStyle,
              cursor: printing ? 'wait' : 'pointer',
              opacity: printing ? 0.6 : 1,
              marginLeft: 'auto',
            }}
          >
            {printing ? 'Generating…' : '🖨 Print'}
          </button>
        </div>

        {printErr ? (
          <p
            data-testid="dr-print-error"
            style={{ marginTop: '0.5rem', color: '#f87171', fontWeight: 600 }}
          >
            {printErr}
          </p>
        ) : null}
      </div>

      {/* Table — hidden until first Search */}
      {!hasSearched ? (
        <div className="card">
          <p style={{ color: '#9ca3af', margin: 0 }}>
            Set filters above and click{' '}
            <strong style={{ color: '#facc15' }}>Search</strong>{' '}
            to view the duty register.
          </p>
        </div>
      ) : (
        <>
          <p
            style={{
              fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.5rem',
            }}
          >
            Showing <strong>{sortedEntries.length}</strong> of{' '}
            <strong>{allEntries.length}</strong> duty slip(s).
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
          ) : sortedEntries.length === 0 ? (
            <div className="card">
              <p style={{ color: '#9ca3af' }}>
                No duty slips match the current filters. Try a wider range or click Clear.
              </p>
            </div>
          ) : (
            <DutyTable
              entries={sortedEntries}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}
        </>
      )}
    </main>
  );
}

// ------------------------------------------------------------------
// Table
// ------------------------------------------------------------------

interface DutyTableProps {
  entries: DutyRegisterEntry[];
  sortKey: DutyRegisterSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: DutyRegisterSortKey) => void;
}

function DutyTable({ entries, sortKey, sortDir, onSort }: DutyTableProps) {
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'auto', maxHeight: '70vh' }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.82rem',
          color: '#f5f5f7',
        }}
      >
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <tr style={{ background: '#1f1f24', color: '#facc15' }}>
            <Th onClick={() => onSort('duty_slip_no')} active={sortKey === 'duty_slip_no'} dir={sortDir}>Slip No</Th>
            <Th onClick={() => onSort('booking_date')} active={sortKey === 'booking_date'} dir={sortDir}>Date</Th>
            <Th onClick={() => onSort('customer')} active={sortKey === 'customer'} dir={sortDir}>Customer</Th>
            <Th onClick={() => onSort('vehicle')} active={sortKey === 'vehicle'} dir={sortDir}>Vehicle</Th>
            <Th onClick={() => onSort('duty_type')} active={sortKey === 'duty_type'} dir={sortDir}>Duty Type</Th>
            <Th onClick={() => onSort('total_km')} active={sortKey === 'total_km'} dir={sortDir} right>KM</Th>
            <Th onClick={() => onSort('total_hours')} active={sortKey === 'total_hours'} dir={sortDir} right>Hrs</Th>
            <Th onClick={() => onSort('total_amount')} active={sortKey === 'total_amount'} dir={sortDir} right>Amount (₹)</Th>
            <th style={thStatic}>Bill</th>
            <Th onClick={() => onSort('status')} active={sortKey === 'status'} dir={sortDir}>Status</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((r, i) => (
            <tr
              key={r.duty_slip_id}
              style={{ background: i % 2 === 1 ? '#16161a' : 'transparent' }}
            >
              <td style={td}>{r.duty_slip_no}</td>
              <td style={td}>{fmtDate(r.booking_date)}</td>
              <td style={td}>
                {r.customer_company_name
                  ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
                  : (r.customer_name ?? '—')}
              </td>
              <td style={td}>{r.vehicle_reg_no ?? '—'}</td>
              <td style={td}>{prettyDutyType(r.duty_type)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.total_km != null ? fmtInt(r.total_km) : '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{r.total_hours != null ? fmtNum(r.total_hours, 1) : '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtNum(r.total_amount)}</td>
              <td style={td}>
                {r.bill_no ? (
                  <Link
                    to={`/reports/bill-register?bill_no=${encodeURIComponent(r.bill_no)}`}
                    style={{ color: 'var(--color-accent)' }}
                    data-testid={`dr-bill-link-${r.bill_no}`}
                  >
                    {r.bill_no}
                  </Link>
                ) : '—'}
              </td>
              <td style={td}>
                <span style={statusBadgeStyle(r.status)}>{r.status.toUpperCase()}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Sub-components + helpers
// ------------------------------------------------------------------

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{label}</span>
      {children}
    </label>
  );
}

function Th({
  children, onClick, active, dir, right = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: 'asc' | 'desc';
  right?: boolean;
}) {
  const arrow = active ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={onClick}
      style={{
        ...thStatic,
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: right ? 'right' : 'left',
        color: active ? '#facc15' : '#9ca3af',
      }}
    >
      {children}{arrow}
    </th>
  );
}

const thStatic: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  textAlign: 'left',
  fontSize: '0.78rem',
  fontWeight: 700,
  borderBottom: '1px solid #2a2a30',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  borderBottom: '1px solid #2a2a30',
  whiteSpace: 'nowrap',
};

function statusBadgeStyle(s: string): React.CSSProperties {
  switch (s) {
    case 'billed':    return { color: '#86efac', fontWeight: 600 };
    case 'closed':    return { color: '#86efac', fontWeight: 600 };
    case 'open':      return { color: '#facc15', fontWeight: 600 };
    case 'cancelled': return { color: '#fca5a5', fontWeight: 600 };
    default:          return { color: '#facc15', fontWeight: 600 };
  }
}

function fmtDate(iso: string): string {
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

function prettyDutyType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------------------
// Company header fetch — same pattern as BillCoverReport.
// ------------------------------------------------------------------

async function fetchCompanyForReportLocal(): Promise<{
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
  const { supabase } = await import('../../services/supabaseClient');
  const r = await supabase.rpc('list_bills_for_company');
  if (r.error || !r.data || (r.data as any[]).length === 0) {
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
