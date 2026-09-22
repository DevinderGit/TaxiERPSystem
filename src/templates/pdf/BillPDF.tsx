/**
 * BillPDF — M11 / TAXI-1101 v2.
 *
 * Renders a billing.bills row + its linked duty slips as a single
 * A4 page matching docs/billTemplate.pdf. Pure renderer: receives
 * a fully-typed `data` prop, emits the PDF. No fetching, no
 * business logic (totals recompute happens in this file using the
 * gst config rates returned by the RPC — see comments below).
 *
 * Layout (mapped 1:1 to the template):
 *   1. "INVOICE" heading — centered, bold
 *   2. Company name — centered
 *   3. 3-column header block:
 *        LEFT   : GSTIN, SAC NO, PAN NO, STATE CODE, S.T.Ctgry
 *        MIDDLE : full address, email
 *        RIGHT  : contact nos, Bill No, Bill Date
 *   4. Customer block:
 *        Client Name / Address
 *        G.S.T. IN + StateCode (same row)
 *        PAN No + Booked By (same row)
 *        Guest (own row, only if present)
 *   5. Line-item table (5 cols):
 *        Date/D.S. No | Vehicle Detail | Duty Description/Particulars | Rate | Amount
 *        Each duty slip spans N rows: first row carries date + DS +
 *        vehicle + first particular line; subsequent rows are the
 *        remaining particular lines (extras) with sparse Rate/Amount.
 *   6. "TOTAL DUTY SLIP ENCLOSED :- N" left, totals block right
 *        TOTAL AMOUNT = base + extra (the bill's stored pre-tax)
 *        IGST @ X% (or CGST + SGST)
 *        Parking/TollTax sub-line (informational — included in TOTAL)
 *        NET AMOUNT = grand_total
 *   7. Grand total in words — Indian Lakh/Crore system with paise
 *   8. "For <company>" + "Authorized Signatory" — right-aligned
 *   9. "Terms & Condition" heading + 6-paragraph block (from
 *      system.settings.bill_terms_and_conditions)
 *
 * Render entry-points:
 *   pdf(<BillPDF data={data} />).toBlob()   → inline iframe (dev preview, M11-1103 PrintPage)
 *   pdf(<BillPDF data={data} />).toBuffer() → tests / file save
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';

import { rupeesInWords } from '../../lib/numberToWordsIndian';
import { gstStateCode } from '../../lib/indianStateCodes';

// ---------------------------------------------------------------------------
// Data shape — what the RPC (public.get_bill_for_pdf) returns.
// ---------------------------------------------------------------------------

export interface BillPDFDutySlipRow {
  duty_slip_no: string;
  booking_date: string;
  start_date: string | null;
  end_date: string | null;
  vehicle_reg_no: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  duty_type: string;
  pickup_location: string | null;
  drop_location: string | null;
  total_km: number | null;
  total_hours: number | null;
  base_amount: number;
  extra_km_amount: number;
  extra_hour_amount: number;
  night_halt_amount: number;
  driver_allowance: number;
  other_charges: number;
  other_charges_remarks: string | null;
  guest_name: string | null;
  total_amount: number;
}

export interface BillPDFCustomer {
  name: string;
  company_name: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface BillPDFCompany {
  id: number;
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
}

export interface BillPDFGst {
  is_interstate: boolean | null;
  igst_rate: number | null;
  cgst_rate: number | null;
  sgst_rate: number | null;
}

export interface BillPDFData {
  bill_no: string;
  bill_date: string;
  status: string;
  remarks: string | null;
  base_amount: number;
  extra_amount: number;
  parking_toll_total: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  total_after_tax: number;
  round_off: number;
  grand_total: number;
  customer: BillPDFCustomer;
  company: BillPDFCompany;
  gst: BillPDFGst | null;
  bill_terms_and_conditions: string | null;
  duty_slips: BillPDFDutySlipRow[];
}

// ---------------------------------------------------------------------------
// Styles — kept inline so the template is self-contained.
// ---------------------------------------------------------------------------

const COLORS = {
  ink: '#111827',
  inkMuted: '#4b5563',
  inkLight: '#6b7280',
  border: '#9ca3af',
  borderSoft: '#d1d5db',
  borderLight: '#e5e7eb',
  rule: '#000000',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.ink,
    lineHeight: 1.3,
  },

  // 1. INVOICE heading
  invoiceHeading: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1,
  },
  companyNameHeading: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 8,
  },

  // 3. 3-column header
  headerRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  headerCol: { flex: 1, paddingRight: 8 },
  headerRightCol: { flex: 1, paddingLeft: 8, alignItems: 'flex-end' },
  headerLabel: {
    fontSize: 8,
    color: COLORS.ink,
    marginBottom: 2,
  },
  headerLabelBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginBottom: 2,
  },
  headerValue: {
    fontSize: 9,
    marginBottom: 2,
  },
  headerValueBig: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  headerAddress: {
    fontSize: 8.5,
    marginBottom: 1,
  },
  headerContactLine: {
    fontSize: 9,
  },

  // Horizontal rule below the header
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    borderBottomStyle: 'solid',
    marginVertical: 6,
  },

  // 4. Customer block
  customerLine: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  customerLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    width: 95,
  },
  customerValue: {
    fontSize: 9,
    flex: 1,
  },
  customerValueRight: {
    fontSize: 9,
    flex: 1,
    textAlign: 'right',
  },

  // 5. Line-item table
  table: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'solid',
    marginTop: 4,
    marginBottom: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderBottomStyle: 'solid',
  },
  tableHeaderCell: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
  },
  tableHeaderRight: { textAlign: 'right' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    borderBottomStyle: 'solid',
    minHeight: 16,
  },
  tableRowLast: {
    flexDirection: 'row',
    borderBottomWidth: 0,
  },
  tableCell: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontSize: 9,
  },
  tableCellRight: { textAlign: 'right' },
  tableCellTop: { fontFamily: 'Helvetica-Bold' },
  dateLineMuted: { color: COLORS.inkLight, fontSize: 8.5 },

  // 6. Totals block
  totalsFooter: {
    flexDirection: 'row',
    marginTop: 6,
    marginBottom: 8,
  },
  slipCount: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    flex: 1,
  },
  totalsTable: { width: 240 },
  totalsLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  totalsLabel: { fontSize: 9 },
  totalsValue: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  totalsNetLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  totalsNetValue: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  totalsBlank: { paddingVertical: 1 },
  totalsSubLabel: {
    fontSize: 8,
    color: COLORS.inkMuted,
    fontStyle: 'italic',
  },

  // 7. Grand total in words
  wordsRow: {
    marginTop: 8,
    marginBottom: 10,
    paddingVertical: 4,
  },
  wordsLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginBottom: 2,
  },
  wordsValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },

  // 8. Signature
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  sigBlock: { width: 220, alignItems: 'center' },
  sigLine1: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sigLine2: { fontSize: 8.5, color: COLORS.inkMuted },

  // 9. Terms
  tncHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  tncBody: {
    fontSize: 8,
    color: COLORS.inkMuted,
    lineHeight: 1.4,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: COLORS.inkLight,
    textAlign: 'center',
  },
});

// ---------------------------------------------------------------------------
// Table column widths (% of total width). Sum = 100.
// ---------------------------------------------------------------------------

const COL = {
  date:   13,
  vehicle: 14,
  particulars: 47,
  rate:   12,
  amount: 14,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const v = Number(n ?? 0);
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function isInterstate(d: BillPDFData): boolean {
  return d.gst?.is_interstate === true;
}

function companyAddressLines(c: BillPDFCompany): string[] {
  const out: string[] = [];
  if (c.address_line1) out.push(c.address_line1);
  if (c.address_line2) out.push(c.address_line2);
  const tail = [c.city, c.state, c.pincode].filter(Boolean).join(', ');
  if (tail) out.push(tail);
  return out;
}

function customerAddressLines(c: BillPDFCustomer): string[] {
  const out: string[] = [];
  if (c.address_line1) out.push(c.address_line1);
  if (c.address_line2) out.push(c.address_line2);
  const tail = [c.city, c.state, c.pincode].filter(Boolean).join(', ');
  if (tail) out.push(tail);
  return out;
}

function dutyTypeLabel(t: string): string {
  // Human-friendly rendering of the enum ("per_km" → "Per KM").
  return t
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the multi-line "Duty Description / Particulars" column for one
 * slip. Each line corresponds to a billable sub-charge; sparse columns
 * (Rate / Amount) line up with the rows.
 *
 *   Line 1 — base: "${DutyType}: ${total_km} km, ${pickup} → ${drop}"
 *   Line 2 — extra_km_amount (if > 0)
 *   Line 3 — extra_hour_amount (if > 0)
 *   Line 4 — night_halt_amount (if > 0)
 *   Line 5 — driver_allowance (if > 0)
 *   Line 6 — other_charges (Parking/Toll) (if > 0)
 *
 * Returned shape lets the row layout decide what fills the Rate /
 * Amount cells (first line gets base_amount; extras get their own
 * amounts).
 */
interface ParticularLine {
  text: string;
  amount: number;        // 0 = amount cell empty
}

function buildParticulars(s: BillPDFDutySlipRow): ParticularLine[] {
  const lines: ParticularLine[] = [];

  // Line 1 — base
  const kmPart = s.total_km != null ? `${fmtInt(s.total_km)} Kms` : '';
  const hrsPart = s.total_hours != null
    ? ` & ${fmtNum(s.total_hours, 1)} Hrs Duty`
    : '';
  const routePart = [s.pickup_location, s.drop_location]
    .filter(Boolean)
    .join(' → ');
  const summary = [
    `${dutyTypeLabel(s.duty_type)} Running${hrsPart ? '' : kmPart ? '' : ''}`,
  ];
  let baseText = `${dutyTypeLabel(s.duty_type)} Running :${kmPart}${hrsPart}`;
  if (routePart) baseText += ` ${routePart}`;
  lines.push({ text: baseText, amount: s.base_amount });

  // Extras
  if (s.extra_km_amount > 0) {
    lines.push({
      text: `Extra KM :${fmtInt(s.total_km ?? 0)} KM`,
      amount: s.extra_km_amount,
    });
  }
  if (s.extra_hour_amount > 0) {
    lines.push({
      text: `Extra Hours :${fmtNum(s.total_hours ?? 0, 1)} Hrs`,
      amount: s.extra_hour_amount,
    });
  }
  if (s.night_halt_amount > 0) {
    lines.push({
      text: `Night Halt`,
      amount: s.night_halt_amount,
    });
  }
  if (s.driver_allowance > 0) {
    lines.push({
      text: `Driver Allowance`,
      amount: s.driver_allowance,
    });
  }
  if (s.other_charges > 0) {
    lines.push({
      text: s.other_charges_remarks?.trim() || 'Parking/Toll',
      amount: s.other_charges,
    });
  }

  // Suppress unused warning — kept for future use.
  void summary;
  return lines;
}

function vehicleLabel(s: BillPDFDutySlipRow): string[] {
  const out: string[] = [];
  const name = [s.vehicle_make, s.vehicle_model].filter(Boolean).join(' ').trim();
  if (name) out.push(name.toUpperCase());
  if (s.vehicle_reg_no) out.push(s.vehicle_reg_no);
  return out;
}

function dateLabel(s: BillPDFDutySlipRow): string[] {
  const out: string[] = [];
  if (s.start_date || s.end_date) {
    out.push(fmtDate(s.start_date || s.booking_date));
    if (s.end_date && s.end_date !== s.start_date) {
      out.push('To');
      out.push(fmtDate(s.end_date));
    }
  }
  if (s.duty_slip_no) {
    // The template puts the DS no. under the date range.
    out.push(s.duty_slip_no);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillPDF({ data }: { data: BillPDFData }): ReactElement {
  const interstate = isInterstate(data);

  return (
    <Document
      title={`Invoice ${data.bill_no}`}
      author={data.company.name}
      subject={`Tax Invoice ${data.bill_no}`}
    >
      <Page size="A4" style={styles.page}>
        {/* ===== INVOICE heading ===== */}
        <Text style={styles.invoiceHeading}>INVOICE</Text>
        <Text style={styles.companyNameHeading}>{data.company.name}</Text>

        {/* ===== 3-column header block ===== */}
        <View style={styles.headerRow}>
          {/* LEFT — tax IDs */}
          <View style={styles.headerCol}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.headerLabelBold}>GSTIN.: </Text>
              <Text style={styles.headerValue}>{data.company.gstin ?? '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.headerLabelBold}>SAC NO.: </Text>
              <Text style={styles.headerValue}>{data.company.sac_no ?? '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.headerLabelBold}>PAN NO.: </Text>
              <Text style={styles.headerValue}>{data.company.pan ?? '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.headerLabelBold}>STATE CODE: </Text>
              <Text style={styles.headerValue}>{data.company.state_code ?? '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.headerLabelBold}>S.T.Ctgry: </Text>
              <Text style={styles.headerValue}>{data.company.st_category ?? '—'}</Text>
            </View>
          </View>

          {/* MIDDLE — address + email */}
          <View style={styles.headerCol}>
            {companyAddressLines(data.company).map((line, i) => (
              <Text key={i} style={styles.headerAddress}>{line}</Text>
            ))}
            {data.company.email ? (
              <Text style={[styles.headerAddress, { marginTop: 6 }]}>
                Email ID: {data.company.email}
              </Text>
            ) : null}
          </View>

          {/* RIGHT — contact, bill no, bill date */}
          <View style={styles.headerRightCol}>
            {data.company.phone ? (
              <Text style={styles.headerContactLine}>
                Contact No.: {data.company.phone}
              </Text>
            ) : null}
            {/* If multiple phones are stored comma-separated, also list them */}
            {data.company.phone && data.company.phone.includes(',')
              ? data.company.phone.split(',').slice(1).map((p, i) => (
                  <Text key={i} style={styles.headerContactLine}>
                    {' '.repeat(13)}{p.trim()}
                  </Text>
                ))
              : null}
            <View style={{ height: 6 }} />
            <Text style={styles.headerLabel}>Bill No. -</Text>
            <Text style={styles.headerValueBig}>{data.bill_no}</Text>
            <Text style={styles.headerLabel}>Bill Date</Text>
            <Text style={styles.headerValue}>{fmtDate(data.bill_date)}</Text>
          </View>
        </View>

        <View style={styles.hr} />

        {/* ===== Customer block ===== */}
        <View style={styles.customerLine}>
          <Text style={styles.customerLabel}>Client Name : </Text>
          <Text style={styles.customerValue}>
            {data.customer.company_name || data.customer.name}
          </Text>
        </View>
        <View style={styles.customerLine}>
          <Text style={styles.customerLabel}>Address : </Text>
          <Text style={styles.customerValue}>
            {customerAddressLines(data.customer).join(', ') || '—'}
          </Text>
        </View>

        <View style={{ height: 6 }} />

        <View style={styles.customerLine}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <Text style={styles.customerLabel}>G.S.T. IN  : </Text>
            <Text style={styles.customerValue}>
              {data.customer.gstin ?? '—'}
            </Text>
          </View>
          <View style={[styles.customerLine, { flex: 1 }]}>
            <Text style={styles.customerLabel}>StateCode : </Text>
            <Text style={styles.customerValue}>
              {gstStateCode(data.customer.state) ?? '—'}
            </Text>
          </View>
        </View>

        <View style={styles.customerLine}>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <Text style={styles.customerLabel}>PAN No     : </Text>
            <Text style={styles.customerValue}>
              {data.customer.pan ?? '—'}
            </Text>
          </View>
          <View style={[styles.customerLine, { flex: 1 }]}>
            <Text style={styles.customerLabel}>Booked By : </Text>
            <Text style={styles.customerValue}>{data.customer.name}</Text>
          </View>
        </View>

        {data.duty_slips.some((s) => s.guest_name) ? (
          <View style={styles.customerLine}>
            <Text style={styles.customerLabel}>Guest</Text>
            <Text style={styles.customerValue}>
              {data.duty_slips.find((s) => s.guest_name)?.guest_name ?? '—'}
            </Text>
          </View>
        ) : null}

        <View style={styles.hr} />

        {/* ===== Line-item table ===== */}
        <View style={styles.table}>
          {/* Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { width: `${COL.date}%` }]}>
              Date/D.S. No.
            </Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.vehicle}%` }]}>
              Vehicle Detail
            </Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.particulars}%` }]}>
              Duty Description/Particulars
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.rate}%` }]}>
              Rate
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.amount}%` }]}>
              Amount
            </Text>
          </View>

          {/* Data rows */}
          {data.duty_slips.map((slip, idx) => {
            const particularLines = buildParticulars(slip);
            const dateLines = dateLabel(slip);
            const vehicleLines = vehicleLabel(slip);
            const rowCount = Math.max(
              particularLines.length,
              dateLines.length,
              vehicleLines.length,
              1,
            );
            const isLast = idx === data.duty_slips.length - 1;

            return (
              <View
                key={slip.duty_slip_no + idx}
                style={isLast ? styles.tableRowLast : styles.tableRow}
                wrap={false}
              >
                {/* Date / D.S. No. column */}
                <View
                  style={[
                    { width: `${COL.date}%` },
                    { flexDirection: 'column', paddingHorizontal: 4, paddingVertical: 3 },
                  ]}
                >
                  {dateLines.length === 0 ? null : (
                    <>
                      <Text style={[styles.tableCell, styles.tableCellTop]}>
                        {dateLines[0]}
                      </Text>
                      {dateLines.slice(1).map((l, i) => (
                        <Text
                          key={i}
                          style={
                            l === 'To'
                              ? styles.dateLineMuted
                              : styles.tableCell
                          }
                        >
                          {l}
                        </Text>
                      ))}
                    </>
                  )}
                </View>

                {/* Vehicle Detail column */}
                <View
                  style={[
                    { width: `${COL.vehicle}%` },
                    { flexDirection: 'column', paddingHorizontal: 4, paddingVertical: 3 },
                  ]}
                >
                  {vehicleLines.length === 0 ? null : (
                    <>
                      <Text style={[styles.tableCell, styles.tableCellTop]}>
                        {vehicleLines[0]}
                      </Text>
                      {vehicleLines.slice(1).map((l, i) => (
                        <Text key={i} style={styles.tableCell}>
                          {l}
                        </Text>
                      ))}
                    </>
                  )}
                </View>

                {/* Particulars column — multi-line */}
                <View
                  style={[
                    { width: `${COL.particulars}%` },
                    { flexDirection: 'column', paddingHorizontal: 4, paddingVertical: 3 },
                  ]}
                >
                  {particularLines.map((p, i) => (
                    <Text
                      key={i}
                      style={[styles.tableCell, i === 0 ? styles.tableCellTop : {}]}
                    >
                      {p.text}
                    </Text>
                  ))}
                </View>

                {/* Rate column — sparse, first row only */}
                <View
                  style={[
                    { width: `${COL.rate}%` },
                    { flexDirection: 'column', paddingHorizontal: 4, paddingVertical: 3, alignItems: 'flex-end' },
                  ]}
                >
                  {Array.from({ length: rowCount }).map((_, i) => {
                    const line = particularLines[i];
                    if (!line) {
                      return <Text key={i} style={[styles.tableCell, styles.tableCellRight]}>{''}</Text>;
                    }
                    // Show a rate only on the first row (base) — we don't
                    // have per-line rates from the schema, so the rate
                    // column is empty for extras. Keeps the visual layout
                    // identical to the template.
                    return (
                      <Text
                        key={i}
                        style={[styles.tableCell, styles.tableCellRight, i === 0 ? styles.tableCellTop : {}]}
                      >
                        {''}
                      </Text>
                    );
                  })}
                </View>

                {/* Amount column — populated per particular line */}
                <View
                  style={[
                    { width: `${COL.amount}%` },
                    { flexDirection: 'column', paddingHorizontal: 4, paddingVertical: 3, alignItems: 'flex-end' },
                  ]}
                >
                  {particularLines.map((p, i) => (
                    <Text
                      key={i}
                      style={[
                        styles.tableCell,
                        styles.tableCellRight,
                        i === 0 ? styles.tableCellTop : {},
                      ]}
                    >
                      {fmtNum(p.amount)}
                    </Text>
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* ===== Footer: slip count + totals ===== */}
        <View style={styles.totalsFooter}>
          <Text style={styles.slipCount}>
            TOTAL DUTY SLIP ENCLOSED :- {data.duty_slips.length}
          </Text>

          <View style={styles.totalsTable}>
            <View style={styles.totalsLine}>
              <Text style={styles.totalsLabel}>TOTAL AMOUNT</Text>
              <Text style={styles.totalsValue}>
                {fmtNum(data.base_amount + data.extra_amount)}
              </Text>
            </View>

            {interstate ? (
              <View style={styles.totalsLine}>
                <Text style={styles.totalsLabel}>
                  IGST( @ {fmtNum(data.gst?.igst_rate ?? 0, 2)} % )
                </Text>
                <Text style={styles.totalsValue}>{fmtNum(data.igst_amount)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.totalsLine}>
                  <Text style={styles.totalsLabel}>
                    CGST( @ {fmtNum(data.gst?.cgst_rate ?? 0, 2)} % )
                  </Text>
                  <Text style={styles.totalsValue}>{fmtNum(data.cgst_amount)}</Text>
                </View>
                <View style={styles.totalsLine}>
                  <Text style={styles.totalsLabel}>
                    SGST( @ {fmtNum(data.gst?.sgst_rate ?? 0, 2)} % )
                  </Text>
                  <Text style={styles.totalsValue}>{fmtNum(data.sgst_amount)}</Text>
                </View>
              </>
            )}

            {data.parking_toll_total > 0 ? (
              <>
                <View style={styles.totalsBlank} />
                <View style={styles.totalsLine}>
                  <Text style={styles.totalsValue} />
                  <Text style={styles.totalsValue}>
                    {fmtNum(data.parking_toll_total)}
                  </Text>
                </View>
                <View style={styles.totalsLine}>
                  <Text style={styles.totalsSubLabel}>
                    Parking/TollTax Detail
                  </Text>
                  <Text style={styles.totalsValue} />
                </View>
              </>
            ) : null}

            <View style={styles.totalsLine}>
              <Text style={styles.totalsNetLabel}>NET AMOUNT</Text>
              <Text style={styles.totalsNetValue}>
                {fmtNum(data.grand_total)}
              </Text>
            </View>
          </View>
        </View>

        {/* ===== Grand total in words ===== */}
        <View style={styles.wordsRow}>
          <Text style={styles.wordsLabel}>Rupees (in words)</Text>
          <Text style={styles.wordsValue}>
            {rupeesInWords(data.grand_total)}
          </Text>
        </View>

        {/* ===== Signature ===== */}
        <View style={styles.sigRow}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLine1}>For {data.company.name}</Text>
            <Text style={styles.sigLine2}>Authorized Signatory</Text>
          </View>
        </View>

        {/* ===== Terms & Conditions ===== */}
        {data.bill_terms_and_conditions ? (
          <>
            <Text style={styles.tncHeading}>Terms &amp; Condition</Text>
            <Text style={styles.tncBody}>
              {data.bill_terms_and_conditions}
            </Text>
          </>
        ) : (
          <Text style={styles.tncBody}>
            Terms &amp; conditions not configured. Set the
            `bill_terms_and_conditions` key in Settings.
          </Text>
        )}

        {/* ===== Footer ===== */}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Invoice ${data.bill_no}  •  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

export default BillPDF;
