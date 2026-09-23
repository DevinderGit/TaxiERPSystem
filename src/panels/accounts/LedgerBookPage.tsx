/**
 * LedgerBookPage — M12 / TAXI-1201.
 *
 * Operator scope (per their feedback):
 *   "No Url needed in Ledger, Ledger will show bill number, client
 *    and amount credited for now according to the bill numeber range
 *    filter and it is printable same like bills in pdf format."
 *
 * So this is a deliberately smaller version of the spec's ledger:
 *   - One filter: bill-number range (from / to, numeric-tail aware)
 *   - Search button (not auto)
 *   - One row per bill: bill_no | bill_date | customer | status | amount
 *   - Total row at the bottom
 *   - Print → LedgerPDF via PdfTemplateFactory (A4, same company
 *     header as BillPDF)
 *
 * Cancelled-bill handling: the recycle-on-cancel M10 work produces
 * duplicate rows for the same bill_no. We dedupe in `useLedgerData`
 * to keep the issued row over a cancelled one.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { useAuth } from '../../hooks/useAuth';
import {
  dedupeByBillNo,
  digitsToBillNoNumber,
  filterByBillNoRange,
  useLedgerQuery,
  type LedgerEntry,
} from '../../hooks/useLedgerData';
import {
  revokeBlobURL,
} from '../../services/PdfTemplateFactory';
import { LedgerPDF } from '../../templates/pdf/LedgerPDF';

export function LedgerBookPage() {
  const { companyId } = useAuth();
  const ledgerQuery = useLedgerQuery(companyId);

  const [fromDigits, setFromDigits]     = useState<string>('');
  const [toDigits,   setToDigits]       = useState<string>('');
  const [appliedFrom, setAppliedFrom]   = useState<number | null>(null);
  const [appliedTo,   setAppliedTo]     = useState<number | null>(null);
  const [hasSearched, setHasSearched]   = useState<boolean>(false);

  const [printing, setPrinting]         = useState(false);
  const [printError, setPrintError]     = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl]     = useState<string | null>(null);

  // Cleanup blob URL on change / unmount.
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) revokeBlobURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  // Dedupe (recycle-on-cancel) and apply the requested range.
  const allEntries: LedgerEntry[] = useMemo(
    () => dedupeByBillNo(ledgerQuery.data ?? []),
    [ledgerQuery.data],
  );
  const filteredEntries: LedgerEntry[] = useMemo(
    () => filterByBillNoRange(allEntries, appliedFrom, appliedTo),
    [allEntries, appliedFrom, appliedTo],
  );
  const total = useMemo(
    () => filteredEntries.reduce(
      (acc, r) => acc + Number(r.grand_total ?? 0), 0,
    ),
    [filteredEntries],
  );

  const handleSearch = () => {
    const f = digitsToBillNoNumber(fromDigits);
    const t = digitsToBillNoNumber(toDigits);
    if (f != null && t != null && f > t) {
      window.alert('From bill number must be ≤ to bill number.');
      return;
    }
    setAppliedFrom(f);
    setAppliedTo(t);
    setHasSearched(true);
  };

  const handleClear = () => {
    setFromDigits('');
    setToDigits('');
    setAppliedFrom(null);
    setAppliedTo(null);
    setHasSearched(false);
  };

  // Print button — generate the LedgerPDF client-side.
  const handlePrint = useCallback(async () => {
    if (printing) return;
    setPrinting(true);
    setPrintError(null);
    setPdfBlobUrl((prev) => {
      if (prev) revokeBlobURL(prev);
      return null;
    });
    try {
      const fromRaw = fromDigits.trim();
      const toRaw   = toDigits.trim();
      const fromBillNo = fromRaw ? `BL-${fromRaw.padStart(4, '0')}` : '*';
      const toBillNo   = toRaw   ? `BL-${toRaw.padStart(4, '0')}`   : '*';

      // Build LedgerPDFData directly using the data already in memory
      // — avoids a second RPC round-trip. We still need the company
      // header; fetch from the first row's company columns (already
      // joined in by the RPC's CROSS JOIN LATERAL).
      const r0 = allEntries[0];
      const company = r0 ? {
        name:          String((r0 as any).company_name ?? ''),
        legal_name:    ((r0 as any).company_legal_name as string | null) ?? null,
        gstin:         ((r0 as any).company_gstin as string | null) ?? null,
        pan:           ((r0 as any).company_pan as string | null) ?? null,
        sac_no:        ((r0 as any).company_sac_no as string | null) ?? null,
        state_code:    ((r0 as any).company_state_code as string | null) ?? null,
        st_category:   ((r0 as any).company_st_category as string | null) ?? null,
        address_line1: ((r0 as any).company_address_line1 as string | null) ?? null,
        address_line2: ((r0 as any).company_address_line2 as string | null) ?? null,
        city:          ((r0 as any).company_city as string | null) ?? null,
        state:         ((r0 as any).company_state as string | null) ?? null,
        pincode:       ((r0 as any).company_pincode as string | null) ?? null,
        phone:         ((r0 as any).company_phone as string | null) ?? null,
        email:         ((r0 as any).company_email as string | null) ?? null,
        logo_data_uri: null,
      } : null;

      if (!company) {
        throw new Error('No company data available.');
      }

      const blob = await pdf(
        <LedgerPDF
          data={{
            company,
            fromBillNo,
            toBillNo,
            generatedAt: new Date().toISOString(),
            entries: filteredEntries,
            total,
          }}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      setPdfBlobUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrintError(`Print failed: ${msg}`);
    } finally {
      setPrinting(false);
    }
  }, [allEntries, filteredEntries, fromDigits, toDigits, total, printing]);

  // Range display for the header.
  const rangeLabel =
    appliedFrom != null || appliedTo != null
      ? `${appliedFrom ?? '*'} ${'→'} ${appliedTo ?? '*'}`
      : 'all bills';

  return (
    <main className="app-main">
      <h1 className="page-title">
        Ledger <span className="page-title__accent">Book</span>
      </h1>
      <p className="page-subtitle">
        Bill summary with customer + grand total. Filter by bill
        number range, then print as PDF.
      </p>

      {/* ===== Filter bar ===== */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label
            htmlFor="ledger-from"
            style={{ fontSize: '0.85rem', color: '#9ca3af' }}
          >
            From bill no
          </label>
          <input
            id="ledger-from"
            data-testid="ledger-from"
            type="text"
            value={fromDigits}
            onChange={(e) => setFromDigits(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="1"
            style={{
              padding: '0.45rem 0.6rem',
              background: 'transparent',
              color: '#f5f5f7',
              border: '1px solid #2a2a30',
              borderRadius: 6,
              width: 80,
            }}
          />

          <label
            htmlFor="ledger-to"
            style={{ fontSize: '0.85rem', color: '#9ca3af' }}
          >
            To bill no
          </label>
          <input
            id="ledger-to"
            data-testid="ledger-to"
            type="text"
            value={toDigits}
            onChange={(e) => setToDigits(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="9999"
            style={{
              padding: '0.45rem 0.6rem',
              background: 'transparent',
              color: '#f5f5f7',
              border: '1px solid #2a2a30',
              borderRadius: 6,
              width: 80,
            }}
          />

          <button
            type="button"
            data-testid="ledger-search"
            onClick={handleSearch}
            style={{
              padding: '0.45rem 0.9rem', borderRadius: 6,
              background: '#facc15', color: '#0c0c0e', border: 'none',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Search
          </button>

          <button
            type="button"
            data-testid="ledger-clear"
            onClick={handleClear}
            style={{
              padding: '0.45rem 0.9rem', borderRadius: 6,
              background: 'transparent', color: '#facc15',
              border: '1px solid #facc15', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clear
          </button>

          <button
            type="button"
            data-testid="ledger-print"
            onClick={() => void handlePrint()}
            disabled={printing}
            style={{
              padding: '0.45rem 0.9rem', borderRadius: 6,
              background: 'transparent', color: '#facc15',
              border: '1px solid #facc15', fontWeight: 600,
              cursor: printing ? 'wait' : 'pointer',
              opacity: printing ? 0.6 : 1,
              marginLeft: 'auto',
            }}
          >
            {printing ? 'Generating…' : '🖨 Print Ledger'}
          </button>
        </div>

        {printError ? (
          <p
            data-testid="ledger-print-error"
            style={{ marginTop: '0.5rem', color: '#f87171', fontWeight: 600 }}
          >
            {printError}
          </p>
        ) : null}
      </div>

      {/* ===== Table (hidden until first Search) ===== */}
      {!hasSearched ? (
        <div className="card">
          <p style={{ color: '#9ca3af' }}>
            Pick a bill-number range above and click{' '}
            <strong style={{ color: '#facc15' }}>Search</strong>{' '}
            to view the ledger.
          </p>
        </div>
      ) : (
        <>
          {/* Summary line */}
          <p
            style={{
              fontSize: '0.85rem',
              color: '#9ca3af',
              marginBottom: '0.5rem',
            }}
          >
            Showing <strong>{filteredEntries.length}</strong> of{' '}
            <strong>{allEntries.length}</strong> bill(s) — range {rangeLabel}.
            Total: <strong>₹{total.toFixed(2)}</strong>.
          </p>

          {/* Table */}
          {ledgerQuery.isLoading ? (
            <div className="card"><p style={{ color: '#9ca3af' }}>Loading…</p></div>
          ) : ledgerQuery.isError ? (
            <div className="card">
              <p style={{ color: '#f87171' }}>
                Failed to load: {(ledgerQuery.error as Error).message}
              </p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="card">
              <p style={{ color: '#9ca3af' }}>
                No bills in the selected range. Try a wider range or click Clear.
              </p>
            </div>
          ) : (
            <LedgerTable entries={filteredEntries} total={total} />
          )}
        </>
      )}
    </main>
  );
}

function LedgerTable({ entries, total }: { entries: LedgerEntry[]; total: number }) {
  return (
    <div
      className="card"
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.9rem',
          color: '#f5f5f7',
        }}
      >
        <thead>
          <tr style={{ background: '#1f1f24', color: '#facc15' }}>
            <th style={th}>Bill No</th>
            <th style={th}>Date</th>
            <th style={th}>Customer</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((r, i) => (
            <tr
              key={r.bill_no + r.id + i}
              style={{ background: i % 2 === 1 ? '#16161a' : 'transparent' }}
            >
              <td style={td}>{r.bill_no}</td>
              <td style={td}>{fmtDate(r.bill_date)}</td>
              <td style={td}>{r.customer_name ?? '—'}</td>
              <td style={td}>
                <span style={statusBadgeStyle(r.status)}>
                  {r.status.toUpperCase()}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                {fmtNum(r.grand_total)}
              </td>
            </tr>
          ))}
          <tr style={{ background: '#fffbeb', color: '#0c0c0e' }}>
            <td style={{ ...td, fontWeight: 700 }} colSpan={4}>
              GRAND TOTAL
            </td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
              ₹{fmtNum(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------
// Inline styles (kept local so the LedgerBookPage reads as one file)
// ------------------------------------------------------------------

const th: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  textAlign: 'left',
  fontSize: '0.85rem',
  fontWeight: 600,
  borderBottom: '1px solid #2a2a30',
};

const td: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderBottom: '1px solid #2a2a30',
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
