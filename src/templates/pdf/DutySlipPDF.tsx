/**
 * DutySlipPDF — M11 / TAXI-1102.
 *
 * A4 page rendering one duty slip. Pure renderer — receives a fully
 * typed `data` prop and emits the PDF. Layout per TaskList.md §11:
 *
 *   1. Company header    — compact 3-column (GSTIN/SAC/PAN + address + contact)
 *   2. Title             — "DUTY SLIP" centered, slip no + booking_date
 *   3. Customer + Guest  — two blocks side-by-side
 *   4. Vehicle info      — reg + group + type
 *   5. Duty details      — start dt, end dt, opening/closing km, total km, total hours
 *   6. Rate breakdown    — base + each extra + total
 *   7. Driver details    — name + phone
 *   8. Signature lines   — "Operator Signature" + "Driver Signature"
 *   9. T&C footer        — compact, from system.settings
 *
 * Render entry-points:
 *   pdf(<DutySlipPDF data={data} />).toBlob()   → inline iframe
 *   pdf(<DutySlipPDF data={data} />).toBuffer() → tests
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

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

export interface DutySlipPDFCustomer {
  name: string;
  company_name: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  address_line1: string | null;
  city: string | null;
  pincode: string | null;
}

export interface DutySlipPDFVehicle {
  registration_no: string;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicle_group_name: string | null;
  vehicle_type_name: string | null;
}

export interface DutySlipPDFCompany {
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

export interface DutySlipPDFData {
  duty_slip_no: string;
  booking_date: string;
  booking_ref: string | null;
  status: string;
  duty_type: string;
  duty_start_dt: string;
  duty_end_dt: string | null;
  opening_km: number | null;
  closing_km: number | null;
  total_km: number | null;
  total_hours: number | null;
  pickup_location: string | null;
  drop_location: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  base_amount: number;
  extra_km_amount: number;
  extra_hour_amount: number;
  night_halt_amount: number;
  driver_allowance: number;
  other_charges: number;
  other_charges_remarks: string | null;
  custom_rate: number | null;
  custom_rate_remarks: string | null;
  total_amount: number;
  bill_id: number | null;
  customer: DutySlipPDFCustomer;
  vehicle: DutySlipPDFVehicle;
  company: DutySlipPDFCompany;
  bill_terms_and_conditions: string | null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const COLORS = {
  ink: '#111827',
  inkMuted: '#4b5563',
  inkLight: '#6b7280',
  border: '#9ca3af',
  borderSoft: '#d1d5db',
  borderLight: '#e5e7eb',
  band: '#fffbeb',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: COLORS.ink,
    lineHeight: 1.3,
  },

  // 1. Company header
  headerRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  headerLeft: { flex: 2, paddingRight: 8 },
  headerRight: { flex: 1, paddingLeft: 8, alignItems: 'flex-end' },
  companyName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  companyLegal: { fontSize: 8.5, color: COLORS.inkMuted, marginBottom: 4 },
  companyMetaLine: {
    fontSize: 8.5,
    color: COLORS.inkMuted,
    lineHeight: 1.35,
  },
  contactLine: { fontSize: 9 },

  hr: {
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
    marginVertical: 6,
  },

  // 2. Title
  titleBlock: {
    alignItems: 'center',
    marginVertical: 4,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  titleMeta: {
    fontSize: 9.5,
  },

  // Section heading
  sectionHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    backgroundColor: COLORS.band,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 4,
    marginTop: 8,
  },

  // 3. Customer + Guest
  twoColRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  twoColBlock: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    borderStyle: 'solid',
    padding: 6,
    marginRight: 6,
  },
  twoColBlockLast: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.borderSoft,
    borderStyle: 'solid',
    padding: 6,
  },
  blockName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  blockMeta: { fontSize: 9, color: COLORS.inkMuted, lineHeight: 1.4 },

  // 4. Vehicle info row
  labelValueRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  labelValueLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    width: 100,
  },
  labelValueValue: { fontSize: 9, flex: 1 },

  // 5. Duty details table + 6. Rate breakdown
  table: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'solid',
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
    paddingHorizontal: 6,
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
  },
  tableRowLast: {
    flexDirection: 'row',
    borderBottomWidth: 0,
  },
  tableCell: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 9.5,
  },
  tableCellRight: { textAlign: 'right' },
  tableTotalRow: {
    backgroundColor: COLORS.band,
  },
  tableTotalLabel: { fontFamily: 'Helvetica-Bold' },
  tableTotalValue: { fontFamily: 'Helvetica-Bold' },

  // 7. Driver details
  driverRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },

  // 8. Signatures
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
  },
  sigBlock: { width: '40%', alignItems: 'center' },
  sigLine: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: COLORS.ink,
    borderTopStyle: 'solid',
    paddingTop: 4,
    fontSize: 9,
    textAlign: 'center',
  },

  // 9. T&C
  tncHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginTop: 16,
    marginBottom: 4,
  },
  tncBody: {
    fontSize: 7.5,
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

  // Misc
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  statusBilled: { backgroundColor: '#dbeafe', color: '#1e3a8a' },
  statusClosed: { backgroundColor: '#dcfce7', color: '#166534' },
  statusOpen:   { backgroundColor: '#fef3c7', color: '#854d0e' },
  statusCancelled: { backgroundColor: '#fee2e2', color: '#991b1b' },
});

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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}`;
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

function dutyTypeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function companyAddressLines(c: DutySlipPDFCompany): string[] {
  const out: string[] = [];
  if (c.address_line1) out.push(c.address_line1);
  if (c.address_line2) out.push(c.address_line2);
  const tail = [c.city, c.state, c.pincode].filter(Boolean).join(', ');
  if (tail) out.push(tail);
  return out;
}

function statusBadgeStyle(s: string) {
  switch (s) {
    case 'billed':    return styles.statusBilled;
    case 'closed':    return styles.statusClosed;
    case 'open':      return styles.statusOpen;
    case 'cancelled': return styles.statusCancelled;
    default:          return styles.statusClosed;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DutySlipPDF({ data }: { data: DutySlipPDFData }): ReactElement {
  const isFlexible = data.duty_type === 'flexible';
  const vehicleLine = [data.vehicle.make, data.vehicle.model]
    .filter(Boolean).join(' ').trim();

  return (
    <Document
      title={`Duty Slip ${data.duty_slip_no}`}
      author={data.company.name}
      subject={`Duty Slip ${data.duty_slip_no}`}
    >
      <Page size="A4" style={styles.page}>
        {/* ===== 1. Company header ===== */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>{data.company.name}</Text>
            {data.company.legal_name ? (
              <Text style={styles.companyLegal}>{data.company.legal_name}</Text>
            ) : null}
            {companyAddressLines(data.company).map((line, i) => (
              <Text key={i} style={styles.companyMetaLine}>{line}</Text>
            ))}
            <Text style={styles.companyMetaLine}>
              {data.company.gstin ? `GSTIN: ${data.company.gstin}` : ''}
              {data.company.gstin && data.company.pan ? '   ' : ''}
              {data.company.pan ? `PAN: ${data.company.pan}` : ''}
            </Text>
          </View>

          <View style={styles.headerRight}>
            {data.company.phone ? (
              <Text style={styles.contactLine}>Contact: {data.company.phone}</Text>
            ) : null}
            {data.company.email ? (
              <Text style={styles.contactLine}>{data.company.email}</Text>
            ) : null}
            {data.company.sac_no ? (
              <Text style={styles.contactLine}>SAC: {data.company.sac_no}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.hr} />

        {/* ===== 2. Title block ===== */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>DUTY SLIP</Text>
          <Text style={styles.titleMeta}>
            Slip No.: {data.duty_slip_no}    •    Booking Date: {fmtDate(data.booking_date)}
            {data.booking_ref ? `    •    Booking Ref: ${data.booking_ref}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Text
              style={[styles.statusBadge, statusBadgeStyle(data.status)]}
            >
              {data.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ===== 3. Customer + Guest ===== */}
        <View style={styles.twoColRow}>
          <View style={styles.twoColBlock}>
            <Text style={styles.sectionHeading}>CUSTOMER</Text>
            <Text style={styles.blockName}>
              {data.customer.company_name || data.customer.name}
            </Text>
            {data.customer.company_name ? (
              <Text style={styles.blockMeta}>Attn: {data.customer.name}</Text>
            ) : null}
            {data.customer.phone ? (
              <Text style={styles.blockMeta}>Ph: {data.customer.phone}</Text>
            ) : null}
            {data.customer.email ? (
              <Text style={styles.blockMeta}>{data.customer.email}</Text>
            ) : null}
            {data.customer.gstin ? (
              <Text style={styles.blockMeta}>GSTIN: {data.customer.gstin}</Text>
            ) : null}
          </View>
          <View style={styles.twoColBlockLast}>
            <Text style={styles.sectionHeading}>GUEST</Text>
            <Text style={styles.blockName}>
              {data.guest_name || '—'}
            </Text>
            {data.guest_phone ? (
              <Text style={styles.blockMeta}>Ph: {data.guest_phone}</Text>
            ) : null}
            {data.pickup_location ? (
              <Text style={styles.blockMeta}>Pickup: {data.pickup_location}</Text>
            ) : null}
            {data.drop_location ? (
              <Text style={styles.blockMeta}>Drop: {data.drop_location}</Text>
            ) : null}
          </View>
        </View>

        {/* ===== 4. Vehicle info ===== */}
        <Text style={styles.sectionHeading}>VEHICLE</Text>
        <View style={{ marginBottom: 4 }}>
          <View style={styles.labelValueRow}>
            <Text style={styles.labelValueLabel}>Registration No.: </Text>
            <Text style={styles.labelValueValue}>{data.vehicle.registration_no}</Text>
          </View>
          <View style={styles.labelValueRow}>
            <Text style={styles.labelValueLabel}>Make / Model: </Text>
            <Text style={styles.labelValueValue}>{vehicleLine || '—'}</Text>
          </View>
          <View style={styles.labelValueRow}>
            <Text style={styles.labelValueLabel}>Group / Type: </Text>
            <Text style={styles.labelValueValue}>
              {data.vehicle.vehicle_group_name || '—'} / {data.vehicle.vehicle_type_name || '—'}
            </Text>
          </View>
        </View>

        {/* ===== 5. Duty details table ===== */}
        <Text style={styles.sectionHeading}>DUTY DETAILS</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Start (date / time)</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>End (date / time)</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Opening KM</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Closing KM</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Total KM</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Total Hrs</Text>
          </View>
          <View style={styles.tableRowLast}>
            <Text style={[styles.tableCell, { flex: 1 }]}>{fmtDateTime(data.duty_start_dt)}</Text>
            <Text style={[styles.tableCell, { flex: 1 }]}>{fmtDateTime(data.duty_end_dt) || '—'}</Text>
            <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
              {data.opening_km != null ? fmtInt(data.opening_km) : '—'}
            </Text>
            <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
              {data.closing_km != null ? fmtInt(data.closing_km) : '—'}
            </Text>
            <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
              {data.total_km != null ? fmtInt(data.total_km) : '—'}
            </Text>
            <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
              {data.total_hours != null ? fmtNum(data.total_hours, 1) : '—'}
            </Text>
          </View>
        </View>

        {/* ===== 6. Rate breakdown ===== */}
        <Text style={styles.sectionHeading}>
          RATE BREAKDOWN{isFlexible ? '  (Flexible)' : ''}
        </Text>
        <View style={styles.table}>
          {isFlexible ? (
            // Flexible duty: one row with custom_rate + remarks
            <View style={styles.tableRowLast}>
              <Text style={[styles.tableCell, { flex: 3 }]}>
                Custom Rate{data.custom_rate_remarks ? ` — ${data.custom_rate_remarks}` : ''}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellRight, styles.tableTotalLabel, styles.tableTotalRow, { flex: 1 }]}>
                {fmtNum(data.total_amount)}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, { flex: 3 }]}>
                  Base ({dutyTypeLabel(data.duty_type)})
                </Text>
                <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                  {fmtNum(data.base_amount)}
                </Text>
              </View>
              {data.extra_km_amount > 0 ? (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>Extra KM</Text>
                  <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                    {fmtNum(data.extra_km_amount)}
                  </Text>
                </View>
              ) : null}
              {data.extra_hour_amount > 0 ? (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>Extra Hours</Text>
                  <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                    {fmtNum(data.extra_hour_amount)}
                  </Text>
                </View>
              ) : null}
              {data.night_halt_amount > 0 ? (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>Night Halt</Text>
                  <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                    {fmtNum(data.night_halt_amount)}
                  </Text>
                </View>
              ) : null}
              {data.driver_allowance > 0 ? (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>Driver Allowance</Text>
                  <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                    {fmtNum(data.driver_allowance)}
                  </Text>
                </View>
              ) : null}
              {data.other_charges > 0 ? (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 3 }]}>
                    Other{data.other_charges_remarks ? ` — ${data.other_charges_remarks}` : ''}
                  </Text>
                  <Text style={[styles.tableCell, styles.tableCellRight, { flex: 1 }]}>
                    {fmtNum(data.other_charges)}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.tableRowLast, styles.tableTotalRow]}>
                <Text style={[styles.tableCell, styles.tableTotalLabel, { flex: 3 }]}>
                  TOTAL
                </Text>
                <Text style={[styles.tableCell, styles.tableCellRight, styles.tableTotalValue, { flex: 1 }]}>
                  {fmtNum(data.total_amount)}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* ===== Total in words (helpful when the slip gets filed) ===== */}
        <Text style={{ fontSize: 8.5, marginTop: 4, marginBottom: 4 }}>
          Rupees (in words): <Text style={{ fontFamily: 'Helvetica-Bold' }}>
            {rupeesInWords(data.total_amount)}
          </Text>
        </Text>

        {/* ===== 7. Driver details ===== */}
        <Text style={styles.sectionHeading}>DRIVER</Text>
        <View style={{ marginBottom: 4 }}>
          <View style={styles.driverRow}>
            <Text style={styles.labelValueLabel}>Name: </Text>
            <Text style={styles.labelValueValue}>{data.driver_name || '—'}</Text>
          </View>
          <View style={styles.driverRow}>
            <Text style={styles.labelValueLabel}>Phone: </Text>
            <Text style={styles.labelValueValue}>{data.driver_phone || '—'}</Text>
          </View>
        </View>

        {/* ===== 8. Signatures ===== */}
        <View style={styles.sigRow}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLine}>Operator Signature</Text>
          </View>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLine}>Driver Signature</Text>
          </View>
        </View>

        {/* ===== 9. T&C ===== */}
        {data.bill_terms_and_conditions ? (
          <>
            <Text style={styles.tncHeading}>Terms &amp; Condition</Text>
            <Text style={styles.tncBody}>
              {data.bill_terms_and_conditions}
            </Text>
          </>
        ) : null}

        {/* ===== Footer ===== */}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Duty Slip ${data.duty_slip_no}  •  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

export default DutySlipPDF;
