/**
 * PdfTemplateFactory — M11 / TAXI-1103.
 *
 * Central registry of all PDF templates in the app. Consumers:
 *
 *   - PrintPage (/daily-work/print) — type dropdown + Preview
 *   - BillingPage success toast "Print Bill" link
 *   - DutySlipListPage row Print button
 *   - BillRegisterReport, DutyRegisterReport, BillCoverReport (M13)
 *
 * Public API:
 *   - `supportedTemplateNames()` — only the ones implemented now
 *   - `getTemplateDisplayName(name)` — human label for the dropdown
 *   - `isTemplateSupported(name)` — type guard
 *   - `fetchData(name, documentNo)` → fetches + projects via the right RPC
 *   - `renderBlob(name, data)` → Promise<Blob>
 *   - `getBlobURL(name, data)` → Promise<string> (URL.createObjectURL)
 *   - `revokeBlobURL(url)` / `revokeBlobURLDelayed(url)` — cleanup
 *
 * Adding a new template:
 *   1. Drop the React-PDF component in src/templates/pdf/<Name>.tsx
 *   2. Add a key to TEMPLATES below pointing at { component }
 *   3. Add a fetchData case (if the template needs new RPC input)
 *   4. (Optional) Add a human label to TEMPLATE_DISPLAY_NAMES
 *
 * The M13 templates (bill_cover_report, duty_register_report) are
 * registered as null — `isTemplateSupported` returns false for them
 * and `renderBlob` throws "coming in M13" if anyone calls it. This
 * lets us reference them by name from the report pages without
 * shipping the templates yet.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';

import { supabase } from './supabaseClient';
import { fetchCompanyLogoDataURI } from './pdfImageLoader';
import {
  BillPDF,
  type BillPDFData,
} from '../templates/pdf/BillPDF';
import {
  DutySlipPDF,
  type DutySlipPDFData,
} from '../templates/pdf/DutySlipPDF';
import {
  LedgerPDF,
  type LedgerPDFData,
} from '../templates/pdf/LedgerPDF';
import {
  BillCoverReportPDF,
  type BillCoverPDFData,
} from '../templates/pdf/BillCoverReportPDF';
import {
  dedupeByBillNo,
  filterByBillNoRange,
  digitsToBillNoNumber,
  type LedgerEntry,
} from '../hooks/useLedgerData';
import {
  filterBillCover,
  totalGrand,
  type BillCoverEntry,
} from '../hooks/useBillCoverData';
import {
  filterDutyRegister,
  type DutyRegisterEntry,
} from '../hooks/useDutyRegisterData';
import {
  DutyRegisterReportPDF,
  type DutyRegisterPDFData,
} from '../templates/pdf/DutyRegisterReportPDF';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TemplateName =
  | 'bill'
  | 'duty_slip'
  | 'bill_cover_report'
  | 'duty_register_report'
  | 'ledger';

export type TemplateData =
  | { name: 'bill'; data: BillPDFData }
  | { name: 'duty_slip'; data: DutySlipPDFData };

interface TemplateEntry {
  component: React.ComponentType<any> | null;
  dataLabel: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TEMPLATES: Record<TemplateName, TemplateEntry> = {
  bill: {
    component: BillPDF,
    dataLabel: 'Bill data (from get_bill_for_pdf RPC)',
  },
  duty_slip: {
    component: DutySlipPDF,
    dataLabel: 'Duty slip data (from get_duty_slip_for_pdf RPC)',
  },
  ledger: {
    component: LedgerPDF,
    dataLabel: 'Ledger entry list + company header',
  },
  // M13 — bill_cover_report is implemented in TAXI-1301.
  bill_cover_report: {
    component: BillCoverReportPDF,
    dataLabel: 'Bill Cover Report data',
  },
  // M13 — duty_register_report is implemented in TAXI-1303.
  duty_register_report: {
    component: DutyRegisterReportPDF,
    dataLabel: 'Duty Register Report data',
  },
};

const TEMPLATE_DISPLAY_NAMES: Record<TemplateName, string> = {
  bill: 'Bill',
  duty_slip: 'Duty Slip',
  ledger: 'Ledger',
  bill_cover_report: 'Bill Cover Report (M13)',
  duty_register_report: 'Duty Register Report (M13)',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Names of templates whose React component is actually shipped. */
export function supportedTemplateNames(): TemplateName[] {
  return (Object.keys(TEMPLATES) as TemplateName[]).filter(
    (k) => TEMPLATES[k].component !== null,
  );
}

export function getTemplateDisplayName(name: TemplateName): string {
  return TEMPLATE_DISPLAY_NAMES[name];
}

export function isTemplateSupported(name: string): name is TemplateName {
  return name in TEMPLATES && TEMPLATES[name as TemplateName].component !== null;
}

export function getTemplateDataLabel(name: TemplateName): string {
  return TEMPLATES[name].dataLabel;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Fetch the data payload for a template by document number.
 *
 * - `bill`        → `get_bill_for_pdf(p_bill_no)`
 * - `duty_slip`   → `get_duty_slip_for_pdf(p_duty_slip_no)`
 *                   Throws a friendly error if the slip is cancelled
 *                   (per TAXI-1102 MTP step 12).
 * - `ledger`      → returns `{ entries, fromBillNo, toBillNo }` parsed
 *                   from `documentNo` like "from-to" (e.g. "1-5").
 *                   Both ends optional: "1-" → from 1; "-5" → to 5;
 *                   "" or "-" → all.
 * - `bill_cover_report` → returns the full Bill Cover Report data
 *                   (no filters at this layer — the page owns
 *                   filtering). `documentNo` is ignored for now.
 * - `duty_register_report` → returns the full Duty Register Report
 *                   data (the page owns filtering). `documentNo` is
 *                   ignored for now.
 */
export async function fetchData(
  name: TemplateName,
  documentNo: string,
): Promise<
  BillPDFData | DutySlipPDFData | LedgerPDFData | BillCoverPDFData | DutyRegisterPDFData
> {
  if (name === 'bill') {
    const id = documentNo.trim();
    if (!id) throw new Error('Bill number is required.');
    return await fetchBillForPdf(id);
  }
  if (name === 'duty_slip') {
    const id = documentNo.trim();
    if (!id) throw new Error('Duty slip number is required.');
    return await fetchDutySlipForPdf(id);
  }
  if (name === 'ledger') {
    return await fetchLedgerPdfData(documentNo);
  }
  if (name === 'bill_cover_report') {
    return await fetchBillCoverPdfData(documentNo);
  }
  if (name === 'duty_register_report') {
    return await fetchDutyRegisterPdfData(documentNo);
  }
  throw new Error(
    `Template "${name}" is not yet implemented (coming in M13).`,
  );
}

// ---------------------------------------------------------------------------
// Bill Cover Report (TAXI-1301)
// ---------------------------------------------------------------------------

/**
 * Build BillCoverPDFData. Filter shape is JSON-encoded in
 * `documentNo` (a string) so the factory signature stays uniform
 * with the other templates. The page passes JSON.stringify(filters).
 */
async function fetchBillCoverPdfData(
  documentNo: string,
): Promise<BillCoverPDFData> {
  let filters: {
    customerName: string;
    guestName: string;
    fromDate: string;
    toDate: string;
  } = { customerName: '', guestName: '', fromDate: '', toDate: '' };
  if (documentNo && documentNo.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(documentNo);
      filters = {
        customerName: String(parsed.customerName ?? ''),
        guestName: String(parsed.guestName ?? ''),
        fromDate: String(parsed.fromDate ?? ''),
        toDate: String(parsed.toDate ?? ''),
      };
    } catch {
      // ignore malformed JSON — use empty filters
    }
  }

  const resp = await supabase.rpc('list_bill_cover_report');
  if (resp.error) throw new Error(resp.error.message);
  const all: BillCoverEntry[] = ((resp.data ?? []) as any[]).map((r) => ({
    bill_id:               Number(r.bill_id),
    bill_no:               String(r.bill_no),
    bill_date:             String(r.bill_date),
    status:                String(r.status),
    remarks:               (r.remarks as string | null) ?? null,
    base_amount:           Number(r.base_amount         ?? 0),
    extra_amount:          Number(r.extra_amount        ?? 0),
    cgst_amount:           Number(r.cgst_amount         ?? 0),
    sgst_amount:           Number(r.sgst_amount         ?? 0),
    igst_amount:           Number(r.igst_amount         ?? 0),
    total_tax:             Number(r.total_tax           ?? 0),
    total_after_tax:       Number(r.total_after_tax     ?? 0),
    round_off:             Number(r.round_off           ?? 0),
    grand_total:           Number(r.grand_total         ?? 0),
    customer_id:           Number(r.customer_id),
    customer_name:         (r.customer_name as string | null) ?? null,
    customer_company_name: (r.customer_company_name as string | null) ?? null,
    customer_gstin:        (r.customer_gstin as string | null) ?? null,
    customer_state:        (r.customer_state as string | null) ?? null,
    duty_slip_count:       Number(r.duty_slip_count ?? 0),
    guest_names:           String(r.guest_names ?? ''),
    created_at:            String(r.created_at ?? ''),
  }));

  const filtered = filterBillCover(all, filters);

  // Company header: piggy-back on the first row's company columns
  // — they are NOT in the bill_cover view (view is bills-only),
  // so the page passes the full company payload directly when
  // rendering. For this factory path we use the company defaults
  // matching the RPC's pattern (empty strings for missing fields).
  // In practice the page uses getBlobURL(...) directly with a
  // hand-built BillCoverPDFData including the company, so this
  // factory path is mostly a placeholder.
  const company = await fetchCompanyForBillCover();

  return {
    company,
    filters,
    generatedAt: new Date().toISOString(),
    entries: filtered,
    total: totalGrand(filtered),
  };
}

/**
 * Fetch the current company via the existing list_bills_for_company
 * RPC which carries company_id on every row. Falls back to a
 * minimal empty-company shape if no bills exist yet.
 */
async function fetchCompanyForBillCover(): Promise<BillCoverPDFData['company']> {
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

// ---------------------------------------------------------------------------
// Duty Register Report (TAXI-1303)
// ---------------------------------------------------------------------------

/**
 * Build DutyRegisterPDFData. `documentNo` is JSON-encoded filters
 * (same pattern as the Bill Cover Report). The page owns filter
 * UX and passes the filter object to this function via JSON.
 */
async function fetchDutyRegisterPdfData(
  documentNo: string,
): Promise<DutyRegisterPDFData> {
  let filters: {
    customerLabel: string;
    vehicleLabel: string;
    status: string;
    fromDate: string;
    toDate: string;
  } = { customerLabel: '', vehicleLabel: '', status: 'all', fromDate: '', toDate: '' };
  if (documentNo && documentNo.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(documentNo);
      filters = {
        customerLabel: String(parsed.customerLabel ?? ''),
        vehicleLabel: String(parsed.vehicleLabel ?? ''),
        status:        String(parsed.status ?? 'all'),
        fromDate:      String(parsed.fromDate ?? ''),
        toDate:        String(parsed.toDate ?? ''),
      };
    } catch {
      // ignore
    }
  }

  const resp = await supabase.rpc('list_duty_register_report');
  if (resp.error) throw new Error(resp.error.message);
  const all: DutyRegisterEntry[] = ((resp.data ?? []) as any[]).map((r) => ({
    duty_slip_id:          Number(r.duty_slip_id),
    duty_slip_no:          String(r.duty_slip_no),
    booking_date:          String(r.booking_date),
    duty_type:             String(r.duty_type),
    status:                String(r.status),
    total_km:              r.total_km    != null ? Number(r.total_km)    : null,
    total_hours:           r.total_hours != null ? Number(r.total_hours) : null,
    base_amount:           Number(r.base_amount  ?? 0),
    total_amount:          Number(r.total_amount ?? 0),
    bill_id:               r.bill_id    != null ? Number(r.bill_id)    : null,
    bill_no:               (r.bill_no     as string | null) ?? null,
    bill_status:           (r.bill_status as string | null) ?? null,
    customer_id:           Number(r.customer_id),
    customer_name:         (r.customer_name         as string | null) ?? null,
    customer_company_name: (r.customer_company_name as string | null) ?? null,
    vehicle_id:            Number(r.vehicle_id),
    vehicle_reg_no:        (r.vehicle_reg_no as string | null) ?? null,
    created_at:            String(r.created_at ?? ''),
  }));

  // Filter via the shared helper — same semantics as the page.
  const filtered = filterDutyRegister(all, {
    customerId: '', // labels are for display only; the page passes
    vehicleId:  '', // concrete ids in the SPA filter
    status:     filters.status,
    fromDate:   filters.fromDate,
    toDate:     filters.toDate,
  });

  const company = await fetchCompanyForReport();
  const total = filtered.reduce(
    (acc, r) => acc + Number(r.total_amount ?? 0), 0,
  );

  return {
    company,
    filters,
    generatedAt: new Date().toISOString(),
    entries: filtered,
    total,
  };
}

async function fetchCompanyForReport(): Promise<
  Pick<
    DutyRegisterPDFData['company'],
    keyof DutyRegisterPDFData['company']
  >
> {
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

/**
 * Build the full LedgerPDFData: fetch all bills, apply the numeric
 * range filter, fetch the company header data, compute the total.
 *
 * `rangeInput` format: "from-to" with either side optional.
 *   "1-5"   → from 1 to 5
 *   "1-"    → from 1 to open
 *   "-5"    → from open to 5
 *   "" or "-" → all
 *   "3"     → just bill 3
 */
async function fetchLedgerPdfData(rangeInput: string): Promise<LedgerPDFData> {
  const trimmed = (rangeInput ?? '').trim();
  let fromRaw = '';
  let toRaw   = '';
  if (trimmed.includes('-')) {
    const [f, t] = trimmed.split('-', 2);
    fromRaw = (f ?? '').trim();
    toRaw   = (t ?? '').trim();
  } else if (trimmed.length > 0) {
    fromRaw = trimmed;
    toRaw   = trimmed;
  }
  const fromN = digitsToBillNoNumber(fromRaw);
  const toN   = digitsToBillNoNumber(toRaw);
  if (fromN != null && toN != null && fromN > toN) {
    throw new Error('From bill number must be ≤ to bill number.');
  }

  // 1. Bills + customer + company (single round-trip — the RPC
  //    includes company columns via a CROSS JOIN LATERAL).
  const ledgerResp = await supabase.rpc('list_ledger_for_company');
  if (ledgerResp.error) throw new Error(ledgerResp.error.message);
  const rows: any[] = (ledgerResp.data ?? []) as any[];

  if (rows.length === 0) {
    throw new Error('No bills found for this company.');
  }

  // Build the company once from the first row (every row carries the
  // same company data due to the CROSS JOIN LATERAL).
  const r0 = rows[0];
  const logo_data_uri = await fetchCompanyLogoDataURI(
    Number(r0.company_id ?? 0),
    (r0.company_logo_path as string | null) ?? null,
  );

  const company: LedgerPDFData['company'] = {
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
    logo_data_uri,
  };

  // 2. Project bills into LedgerEntry.
  const all: LedgerEntry[] = rows.map((r) => ({
    id:            Number(r.bill_id),
    bill_no:       String(r.bill_no),
    bill_date:     String(r.bill_date),
    customer_id:   Number(r.customer_id),
    customer_name: (r.customer_name as string | null) ?? null,
    status:        String(r.status),
    base_amount:   Number(r.base_amount   ?? 0),
    extra_amount:  Number(r.extra_amount  ?? 0),
    grand_total:   Number(r.grand_total   ?? 0),
    cgst_amount:   Number(r.cgst_amount   ?? 0),
    sgst_amount:   Number(r.sgst_amount   ?? 0),
    igst_amount:   Number(r.igst_amount   ?? 0),
    total_tax:     Number(r.total_tax     ?? 0),
    created_at:    String(r.created_at ?? ''),
  }));

  const deduped = dedupeByBillNo(all);
  const filtered = filterByBillNoRange(deduped, fromN, toN);

  // 3. Display strings
  const fromBillNo = fromRaw ? `BL-${fromRaw.padStart(4, '0')}` : '*';
  const toBillNo   = toRaw   ? `BL-${toRaw.padStart(4, '0')}`   : '*';

  const total = filtered.reduce(
    (acc, r) => acc + Number(r.grand_total ?? 0), 0,
  );

  return {
    company,
    fromBillNo,
    toBillNo,
    generatedAt: new Date().toISOString(),
    entries: filtered,
    total,
  };
}

// ---------------------------------------------------------------------------
// Internals — per-template fetch + project
// ---------------------------------------------------------------------------

async function fetchBillForPdf(billNo: string): Promise<BillPDFData> {
  const resp = await supabase.rpc('get_bill_for_pdf', { p_bill_no: billNo });
  if (resp.error) throw new Error(resp.error.message);
  const payload: any = resp.data;
  if (!payload) throw new Error(`Bill ${billNo} not found`);

  const cust: any = payload.customer ?? {};
  const comp: any = payload.company ?? {};
  const gst: any = payload.gst ?? null;
  const slips: any[] = Array.isArray(payload.duty_slips) ? payload.duty_slips : [];

  const dutySlipRows: BillPDFData['duty_slips'] = slips.map((r) => ({
    duty_slip_no:        String(r.duty_slip_no ?? ''),
    booking_date:        String(r.booking_date ?? ''),
    start_date:          (r.start_date as string | null) ?? null,
    end_date:            (r.end_date   as string | null) ?? null,
    vehicle_reg_no:      (r.vehicle_reg_no as string | null) ?? null,
    vehicle_make:        (r.vehicle_make as string | null) ?? null,
    vehicle_model:       (r.vehicle_model as string | null) ?? null,
    duty_type:           String(r.duty_type ?? ''),
    pickup_location:     (r.pickup_location as string | null) ?? null,
    drop_location:       (r.drop_location as string | null) ?? null,
    total_km:            (r.total_km as number | null) ?? null,
    total_hours:         (r.total_hours as number | null) ?? null,
    base_amount:         Number(r.base_amount       ?? 0),
    extra_km_amount:     Number(r.extra_km_amount   ?? 0),
    extra_hour_amount:   Number(r.extra_hour_amount ?? 0),
    night_halt_amount:   Number(r.night_halt_amount ?? 0),
    driver_allowance:    Number(r.driver_allowance  ?? 0),
    other_charges:       Number(r.other_charges     ?? 0),
    other_charges_remarks: (r.other_charges_remarks as string | null) ?? null,
    guest_name:          (r.guest_name as string | null) ?? null,
    total_amount:        Number(r.total_amount      ?? 0),
  }));

  const logo_data_uri = await fetchCompanyLogoDataURI(
    comp.id as number,
    (comp.logo_path as string | null) ?? null,
  );

  return {
    bill_no:           String(payload.bill_no ?? ''),
    bill_date:         String(payload.bill_date ?? ''),
    status:            String(payload.status ?? 'issued'),
    remarks:           (payload.remarks as string | null) ?? null,
    base_amount:       Number(payload.base_amount        ?? 0),
    extra_amount:      Number(payload.extra_amount       ?? 0),
    parking_toll_total: Number(payload.parking_toll_total ?? 0),
    cgst_amount:       Number(payload.cgst_amount        ?? 0),
    sgst_amount:       Number(payload.sgst_amount        ?? 0),
    igst_amount:       Number(payload.igst_amount        ?? 0),
    total_tax:         Number(payload.total_tax          ?? 0),
    total_after_tax:   Number(payload.total_after_tax    ?? 0),
    round_off:         Number(payload.round_off          ?? 0),
    grand_total:       Number(payload.grand_total        ?? 0),
    customer: {
      name:          String(cust.name ?? ''),
      company_name:  (cust.company_name as string | null) ?? null,
      gstin:         (cust.gstin as string | null) ?? null,
      pan:           (cust.pan as string | null)   ?? null,
      state:         (cust.state as string | null) ?? null,
      address_line1: (cust.address_line1 as string | null) ?? null,
      address_line2: (cust.address_line2 as string | null) ?? null,
      city:          (cust.city as string | null)  ?? null,
      pincode:       (cust.pincode as string | null) ?? null,
      phone:         (cust.phone as string | null) ?? null,
      email:         (cust.email as string | null) ?? null,
    },
    company: {
      id:            Number(comp.id ?? 0),
      name:          String(comp.name ?? ''),
      legal_name:    (comp.legal_name as string | null) ?? null,
      gstin:         (comp.gstin as string | null) ?? null,
      pan:           (comp.pan as string | null)   ?? null,
      sac_no:        (comp.sac_no as string | null) ?? null,
      state_code:    (comp.state_code as string | null) ?? null,
      st_category:   (comp.st_category as string | null) ?? null,
      address_line1: (comp.address_line1 as string | null) ?? null,
      address_line2: (comp.address_line2 as string | null) ?? null,
      city:          (comp.city as string | null)  ?? null,
      state:         (comp.state as string | null) ?? null,
      pincode:       (comp.pincode as string | null) ?? null,
      phone:         (comp.phone as string | null) ?? null,
      email:         (comp.email as string | null) ?? null,
      logo_data_uri,
    },
    gst: gst ? {
      is_interstate: gst.is_interstate === true,
      igst_rate:     (gst.igst_rate as number | null) ?? null,
      cgst_rate:     (gst.cgst_rate as number | null) ?? null,
      sgst_rate:     (gst.sgst_rate as number | null) ?? null,
    } : null,
    bill_terms_and_conditions:
      (payload.bill_terms_and_conditions as string | null) ?? null,
    duty_slips: dutySlipRows,
  };
}

async function fetchDutySlipForPdf(slipNo: string): Promise<DutySlipPDFData> {
  const resp = await supabase.rpc('get_duty_slip_for_pdf', {
    p_duty_slip_no: slipNo,
  });
  if (resp.error) throw new Error(resp.error.message);
  const payload: any = resp.data;
  if (!payload) throw new Error(`Duty slip ${slipNo} not found`);

  // Per TAXI-1102 MTP step 12 — cancelled slips cannot be printed.
  if (String(payload.status ?? '') === 'cancelled') {
    throw new Error(
      `Duty slip ${payload.duty_slip_no} is cancelled and cannot be printed.`,
    );
  }

  const cust: any = payload.customer ?? {};
  const comp: any = payload.company ?? {};
  const veh: any  = payload.vehicle ?? {};

  const logo_data_uri = await fetchCompanyLogoDataURI(
    comp.id as number,
    (comp.logo_path as string | null) ?? null,
  );

  return {
    duty_slip_no:          String(payload.duty_slip_no ?? ''),
    booking_date:          String(payload.booking_date ?? ''),
    booking_ref:           (payload.booking_ref as string | null) ?? null,
    status:                String(payload.status ?? 'closed'),
    duty_type:             String(payload.duty_type ?? ''),
    duty_start_dt:         String(payload.duty_start_dt ?? ''),
    duty_end_dt:           (payload.duty_end_dt as string | null) ?? null,
    opening_km:            (payload.opening_km as number | null) ?? null,
    closing_km:            (payload.closing_km as number | null) ?? null,
    total_km:              (payload.total_km as number | null) ?? null,
    total_hours:           (payload.total_hours as number | null) ?? null,
    pickup_location:       (payload.pickup_location as string | null) ?? null,
    drop_location:         (payload.drop_location as string | null) ?? null,
    guest_name:            (payload.guest_name as string | null) ?? null,
    guest_phone:           (payload.guest_phone as string | null) ?? null,
    driver_name:           (payload.driver_name as string | null) ?? null,
    driver_phone:          (payload.driver_phone as string | null) ?? null,
    base_amount:           Number(payload.base_amount       ?? 0),
    extra_km_amount:       Number(payload.extra_km_amount   ?? 0),
    extra_hour_amount:     Number(payload.extra_hour_amount ?? 0),
    night_halt_amount:     Number(payload.night_halt_amount ?? 0),
    driver_allowance:      Number(payload.driver_allowance  ?? 0),
    other_charges:         Number(payload.other_charges     ?? 0),
    other_charges_remarks: (payload.other_charges_remarks as string | null) ?? null,
    custom_rate:           (payload.custom_rate as number | null) ?? null,
    custom_rate_remarks:   (payload.custom_rate_remarks as string | null) ?? null,
    total_amount:          Number(payload.total_amount      ?? 0),
    bill_id:               (payload.bill_id as number | null) ?? null,
    customer: {
      name:          String(cust.name ?? ''),
      company_name:  (cust.company_name as string | null) ?? null,
      gstin:         (cust.gstin as string | null) ?? null,
      phone:         (cust.phone as string | null) ?? null,
      email:         (cust.email as string | null) ?? null,
      state:         (cust.state as string | null) ?? null,
      address_line1: (cust.address_line1 as string | null) ?? null,
      city:          (cust.city as string | null) ?? null,
      pincode:       (cust.pincode as string | null) ?? null,
    },
    vehicle: {
      registration_no:    String(veh.registration_no ?? ''),
      make:               (veh.make as string | null) ?? null,
      model:              (veh.model as string | null) ?? null,
      color:              (veh.color as string | null) ?? null,
      year:               (veh.year as number | null) ?? null,
      vehicle_group_name: (veh.vehicle_group_name as string | null) ?? null,
      vehicle_type_name:  (veh.vehicle_type_name as string | null) ?? null,
    },
    company: {
      id:            Number(comp.id ?? 0),
      name:          String(comp.name ?? ''),
      legal_name:    (comp.legal_name as string | null) ?? null,
      gstin:         (comp.gstin as string | null) ?? null,
      pan:           (comp.pan as string | null) ?? null,
      sac_no:        (comp.sac_no as string | null) ?? null,
      state_code:    (comp.state_code as string | null) ?? null,
      st_category:   (comp.st_category as string | null) ?? null,
      address_line1: (comp.address_line1 as string | null) ?? null,
      address_line2: (comp.address_line2 as string | null) ?? null,
      city:          (comp.city as string | null) ?? null,
      state:         (comp.state as string | null) ?? null,
      pincode:       (comp.pincode as string | null) ?? null,
      phone:         (comp.phone as string | null) ?? null,
      email:         (comp.email as string | null) ?? null,
      logo_data_uri,
    },
    bill_terms_and_conditions:
      (payload.bill_terms_and_conditions as string | null) ?? null,
  };
}

/**
 * Render a template to a Blob.
 * @throws if the template is registered but not yet implemented (M13 stubs)
 */
export async function renderBlob(
  name: TemplateName,
  data: any,
): Promise<Blob> {
  const entry = TEMPLATES[name];
  if (!entry || entry.component === null) {
    throw new Error(
      `Template "${name}" is not yet implemented (coming in M13).`,
    );
  }
  return await pdf(createElement(entry.component, { data })).toBlob();
}

/**
 * Render a template to a Blob and wrap it in an object URL. The
 * caller MUST revoke the URL with `revokeBlobURL` when done — these
 * URLs hold the entire PDF in memory and will leak otherwise.
 */
export async function getBlobURL(
  name: TemplateName,
  data: any,
): Promise<string> {
  const blob = await renderBlob(name, data);
  return URL.createObjectURL(blob);
}

/**
 * Revoke a blob URL previously returned by getBlobURL.
 * Safe to call with a URL that doesn't match (silently no-ops).
 */
export function revokeBlobURL(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // already revoked — ignore
    }
  }
}

/**
 * Revoke a blob URL after a delay. Useful when you open a blob URL
 * in a new tab — the SPA can't tell when the user closes that tab,
 * so we revoke after a generous window (default 5 min) to free
 * memory without prematurely breaking a slow user.
 */
export function revokeBlobURLDelayed(
  url: string | null | undefined,
  delayMs = 5 * 60 * 1000,
): void {
  if (!url) return;
  setTimeout(() => revokeBlobURL(url), delayMs);
}
