/**
 * PrintPage — M11 / TAXI-1103.
 *
 * Standalone /daily-work/print route. Operator picks a document
 * type (Bill / Duty Slip), types the document number, clicks
 * Preview, sees the PDF in an inline iframe, then either prints it
 * or opens it in a new tab.
 *
 * Renders PDF templates via the PdfTemplateFactory registry. The
 * Billing page toast "Print Bill" link and the Duty Slip list Print
 * button both call the same factory directly — this page is the
 * manual entry point when the operator wants to print by number
 * without scrolling back to the relevant list.
 *
 * Role gating: owner / operator / accountant / viewer (all four
 * can read + print). No write actions on this page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  fetchData,
  getBlobURL,
  getTemplateDisplayName,
  revokeBlobURL,
  supportedTemplateNames,
  type TemplateName,
} from '../../services/PdfTemplateFactory';
import type { BillPDFData } from '../../templates/pdf/BillPDF';
import type { DutySlipPDFData } from '../../templates/pdf/DutySlipPDF';

// PrintPage only exposes Bill + Duty Slip in the dropdown. The
// factory registry carries other templates (ledger from M12, M13
// report stubs) but those get their own dedicated pages.
type PrintPageTemplate = 'bill' | 'duty_slip';

function isPrintPageTemplate(name: string): name is PrintPageTemplate {
  return name === 'bill' || name === 'duty_slip';
}

// ---------------------------------------------------------------------------
// Per-template data fetch is handled by PdfTemplateFactory.fetchData,
// so the data-projection logic lives in exactly one place.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PLACEHOLDER: Record<PrintPageTemplate, string> = {
  bill: 'BL-0001',
  duty_slip: 'DS-0001',
};

export function PrintPage() {
  const { role } = useAuth();
  const [params] = useSearchParams();

  // Allow deep-linking: /daily-work/print?type=bill&id=BL-0001
  const initialType = (params.get('type') ?? 'bill') as TemplateName;
  const initialId   = params.get('id') ?? '';

  const supported = supportedTemplateNames().filter(isPrintPageTemplate);
  const [docType, setDocType] = useState<PrintPageTemplate>(
    isPrintPageTemplate(initialType) ? initialType : (supported[0] ?? 'bill'),
  );
  const [docId, setDocId]         = useState<string>(initialId);
  const [blobUrl, setBlobUrl]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [meta, setMeta]           = useState<string | null>(null);

  // Revoke blob URL on change / unmount
  useEffect(() => {
    return () => {
      if (blobUrl) revokeBlobURL(blobUrl);
    };
  }, [blobUrl]);

  // Keep docType valid if M13 templates get added/removed later.
  useEffect(() => {
    if (!supported.includes(docType)) {
      setDocType(supported[0] ?? 'bill');
    }
  }, [supported, docType]);

  const fetchAndRender = useCallback(async () => {
    const id = docId.trim();
    if (!id) {
      setError('Please enter a document number.');
      return;
    }
    setLoading(true);
    setError(null);
    setMeta(null);
    // Revoke the old blob URL before we replace it.
    setBlobUrl((prev) => {
      if (prev) revokeBlobURL(prev);
      return null;
    });

    try {
      const data = (await fetchData(docType, id)) as BillPDFData | DutySlipPDFData;
      const url = await getBlobURL(docType, data);
      setBlobUrl(url);
      setMeta(buildMeta(docType, data));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [docType, docId]);

  // Auto-render on mount if both params present (deep-link).
  useEffect(() => {
    if (initialId && isPrintPageTemplate(initialType)) {
      void fetchAndRender();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPreview = !!docId.trim() && !loading;

  const openInNewTab = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <main className="app-main">
      <h1 className="page-title">Print Preview</h1>
      <p className="page-subtitle">
        Pick a document type and number, then click Preview. Use the
        in-page PDF for printing, or open it in a new tab.
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label
            htmlFor="print-type"
            style={{ fontSize: '0.85rem', color: '#9ca3af' }}
          >
            Type
          </label>
          <select
            id="print-type"
            data-testid="print-type"
            value={docType}
            onChange={(e) => {
              const v = e.target.value;
              if (isPrintPageTemplate(v)) setDocType(v);
              setBlobUrl(null);
              setMeta(null);
              setError(null);
            }}
            style={{
              padding: '0.45rem 0.6rem',
              background: 'transparent',
              color: '#f5f5f7',
              border: '1px solid #2a2a30',
              borderRadius: 6,
            }}
          >
            {supported.map((name) => (
              <option key={name} value={name}>
                {getTemplateDisplayName(name)}
              </option>
            ))}
          </select>

          <label
            htmlFor="print-id"
            style={{ fontSize: '0.85rem', color: '#9ca3af', marginLeft: 8 }}
          >
            Number
          </label>
          <input
            id="print-id"
            data-testid="print-id"
            type="text"
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canPreview) void fetchAndRender();
            }}
            placeholder={PLACEHOLDER[docType]}
            style={{
              padding: '0.45rem 0.6rem',
              background: 'transparent',
              color: '#f5f5f7',
              border: '1px solid #2a2a30',
              borderRadius: 6,
              minWidth: 160,
            }}
          />

          <button
            type="button"
            data-testid="print-preview-btn"
            onClick={() => void fetchAndRender()}
            disabled={!canPreview}
            style={{
              padding: '0.45rem 0.9rem', borderRadius: 6,
              background: '#facc15', color: '#0c0c0e', border: 'none',
              fontWeight: 600,
              cursor: canPreview ? 'pointer' : 'not-allowed',
              opacity: canPreview ? 1 : 0.5,
            }}
          >
            {loading ? 'Rendering…' : 'Preview'}
          </button>

          {blobUrl ? (
            <>
              <button
                type="button"
                data-testid="print-open-new-tab"
                onClick={openInNewTab}
                style={{
                  padding: '0.45rem 0.9rem', borderRadius: 6,
                  background: 'transparent', color: '#facc15',
                  border: '1px solid #facc15', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Open in new tab
              </button>
              <button
                type="button"
                data-testid="print-print-btn"
                onClick={() => {
                  // The blob URL is inside the iframe. Trigger
                  // the iframe's own print dialog — that's
                  // what the operator expects.
                  const iframe = document.querySelector(
                    'iframe[data-testid="print-iframe"]',
                  ) as HTMLIFrameElement | null;
                  if (iframe && iframe.contentWindow) {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                  }
                }}
                style={{
                  padding: '0.45rem 0.9rem', borderRadius: 6,
                  background: 'transparent', color: '#facc15',
                  border: '1px solid #facc15', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Print
              </button>
            </>
          ) : null}
        </div>

        {role === 'viewer' || role === 'accountant' ? (
          <p style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: '#9ca3af' }}>
            You're signed in as <strong>{role}</strong>. Read-only
            access — printing is allowed but generating new bills or
            slips is not.
          </p>
        ) : null}

        {meta ? (
          <p
            data-testid="print-meta"
            style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#9ca3af' }}
          >
            {meta}
          </p>
        ) : null}
        {error ? (
          <p
            data-testid="print-error"
            style={{ marginTop: '0.5rem', color: '#f87171', fontWeight: 600 }}
          >
            {error}
          </p>
        ) : null}
      </div>

      {blobUrl ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe
            title="PDF preview"
            data-testid="print-iframe"
            src={blobUrl}
            style={{
              width: '100%',
              height: '78vh',
              border: 'none',
              background: '#fff',
            }}
          />
        </div>
      ) : (
        <div className="card">
          <p style={{ color: '#9ca3af' }}>
            {loading
              ? 'Rendering PDF…'
              : 'Pick a document type + number above and click Preview.'}
          </p>
        </div>
      )}
    </main>
  );
}

function buildMeta(
  docType: TemplateName,
  data: BillPDFData | DutySlipPDFData,
): string {
  if (docType === 'bill') {
    const b = data as BillPDFData;
    return `Bill ${b.bill_no} • ${b.duty_slips.length} slip(s) • ` +
      `Base ₹${b.base_amount} + Extra ₹${b.extra_amount} = ` +
      `Grand ₹${b.grand_total}`;
  }
  const s = data as DutySlipPDFData;
  return `Duty Slip ${s.duty_slip_no} • ${s.duty_type} • ` +
    `Total ₹${s.total_amount} • Status: ${s.status}`;
}
