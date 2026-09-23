/**
 * DutyRegisterReportPDF — M13 / TAXI-1303.
 *
 * Tabular PDF: a list of duty slips with customer + vehicle +
 * bill number, filterable + sortable. Layout:
 *
 *   1. Company header    — 3-column GSTIN/SAC/PAN + address + contact
 *   2. Title             — "DUTY REGISTER REPORT" centered
 *   3. Filter context    — customer / vehicle / status / date range / generated
 *   4. Duty-slip table   — 9 cols (slip_no / date / customer / vehicle
 *                          / duty_type / km / hrs / amount / status)
 *   5. Total row         — sum of total_amount
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';

import type { DutyRegisterEntry } from '../../hooks/useDutyRegisterData';

export interface DutyRegisterPDFData {
  company: {
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
  };
  filters: {
    customerLabel: string;
    vehicleLabel: string;
    status: string;
    fromDate: string;
    toDate: string;
  };
  generatedAt: string;
  entries: DutyRegisterEntry[];
  total: number;
}

const COLORS = {
  ink: '#111827',
  inkMuted: '#4b5563',
  inkLight: '#6b7280',
  border: '#9ca3af',
  borderLight: '#e5e7eb',
  band: '#fffbeb',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 28,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: COLORS.ink,
    lineHeight: 1.3,
  },
  invoiceHeading: {
    fontSize: 16, fontFamily: 'Helvetica-Bold',
    textAlign: 'center', marginBottom: 6, letterSpacing: 1,
  },
  companyNameHeading: {
    fontSize: 13, fontFamily: 'Helvetica-Bold',
    textAlign: 'center', marginBottom: 8,
  },
  headerRow: { flexDirection: 'row', marginBottom: 6 },
  headerCol: { flex: 1, paddingRight: 8 },
  headerRightCol: { flex: 1, paddingLeft: 8, alignItems: 'flex-end' },
  headerLabel: { fontSize: 8, marginBottom: 2 },
  headerLabelBold: { fontSize: 8, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  headerValue: { fontSize: 9, marginBottom: 2 },
  headerAddress: { fontSize: 8, marginBottom: 1 },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    borderBottomStyle: 'solid',
    marginVertical: 6,
  },
  contextBlock: { marginBottom: 6 },
  contextLine: { fontSize: 8.5, marginBottom: 1 },
  contextLineBold: { fontFamily: 'Helvetica-Bold' },

  table: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'solid',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderBottomStyle: 'solid',
  },
  tableHeaderCell: {
    paddingHorizontal: 3,
    paddingVertical: 3,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  tableHeaderRight: { textAlign: 'right' },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    borderBottomStyle: 'solid',
  },
  tableRowAlt: { backgroundColor: '#f9fafb' },
  tableCell: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 8.5 },
  tableCellRight: { textAlign: 'right' },

  totalRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.band,
    borderTopWidth: 2,
    borderTopColor: '#facc15',
    borderTopStyle: 'solid',
    paddingHorizontal: 4,
    paddingVertical: 5,
    color: '#0c0c0e',
  },
  totalLabel: {
    flex: 8,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    paddingRight: 8,
  },
  totalValue: { flex: 1, fontSize: 11, fontFamily: 'Helvetica-Bold', textAlign: 'right' },

  sigRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24 },
  sigBlock: { width: 220, alignItems: 'center' },
  sigLine1: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sigLine2: { fontSize: 8.5, color: COLORS.inkMuted },

  emptyMsg: {
    paddingVertical: 16,
    textAlign: 'center',
    color: COLORS.inkMuted,
    fontSize: 10,
  },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 28,
    right: 28,
    fontSize: 7.5,
    color: COLORS.inkLight,
    textAlign: 'center',
  },
});

// 9-column layout, sums to 100
const COL = {
  slipNo:   12,
  date:      9,
  customer: 20,
  vehicle:  11,
  dutyType: 11,
  km:        7,
  hrs:       7,
  amount:   13,
  status:   10,
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
  return Number(n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function dutyTypeLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function companyAddressLines(c: DutyRegisterPDFData['company']): string[] {
  const out: string[] = [];
  if (c.address_line1) out.push(c.address_line1);
  if (c.address_line2) out.push(c.address_line2);
  const tail = [c.city, c.state, c.pincode].filter(Boolean).join(', ');
  if (tail) out.push(tail);
  return out;
}

export function DutyRegisterReportPDF({ data }: { data: DutyRegisterPDFData }): ReactElement {
  const { filters } = data;
  return (
    <Document
      title="Duty Register Report"
      author={data.company.name}
      subject="Duty Register Report"
    >
      <Page size="A4" style={styles.page}>
        {/* Title */}
        <Text style={styles.invoiceHeading}>DUTY REGISTER REPORT</Text>
        <Text style={styles.companyNameHeading}>{data.company.name}</Text>

        {/* Company header */}
        <View style={styles.headerRow}>
          <View style={styles.headerCol}>
            <KV label="GSTIN."    value={data.company.gstin} />
            <KV label="SAC NO."   value={data.company.sac_no} />
            <KV label="PAN NO."   value={data.company.pan} />
            <KV label="STATE CODE" value={data.company.state_code} />
            <KV label="S.T.Ctgry"  value={data.company.st_category} />
          </View>
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
          <View style={styles.headerRightCol}>
            {data.company.phone ? (
              <Text style={{ fontSize: 9 }}>Contact: {data.company.phone}</Text>
            ) : null}
            <View style={{ height: 6 }} />
            <Text style={styles.headerLabel}>Report</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>
              Duty Register
            </Text>
          </View>
        </View>

        <View style={styles.hr} />

        {/* Filter context */}
        <View style={styles.contextBlock}>
          {filters.customerLabel ? (
            <Text style={styles.contextLine}>
              Customer: <Text style={styles.contextLineBold}>{filters.customerLabel}</Text>
            </Text>
          ) : null}
          {filters.vehicleLabel ? (
            <Text style={styles.contextLine}>
              Vehicle: <Text style={styles.contextLineBold}>{filters.vehicleLabel}</Text>
            </Text>
          ) : null}
          {filters.status && filters.status !== 'all' ? (
            <Text style={styles.contextLine}>
              Status: <Text style={styles.contextLineBold}>{filters.status}</Text>
            </Text>
          ) : null}
          {(filters.fromDate || filters.toDate) ? (
            <Text style={styles.contextLine}>
              Date Range:{' '}
              <Text style={styles.contextLineBold}>
                {filters.fromDate || '*'} → {filters.toDate || '*'}
              </Text>
            </Text>
          ) : null}
          <Text style={styles.contextLine}>
            Showing <Text style={styles.contextLineBold}>{data.entries.length}</Text> duty slip(s).
            Generated: <Text style={styles.contextLineBold}>{fmtDateTime(data.generatedAt)}</Text>
          </Text>
        </View>

        {/* Table or empty-state */}
        {data.entries.length === 0 ? (
          <Text style={styles.emptyMsg}>
            No records found for the selected filters.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { width: `${COL.slipNo}%` }]}>Slip No</Text>
              <Text style={[styles.tableHeaderCell, { width: `${COL.date}%` }]}>Date</Text>
              <Text style={[styles.tableHeaderCell, { width: `${COL.customer}%` }]}>Customer</Text>
              <Text style={[styles.tableHeaderCell, { width: `${COL.vehicle}%` }]}>Vehicle</Text>
              <Text style={[styles.tableHeaderCell, { width: `${COL.dutyType}%` }]}>Duty Type</Text>
              <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.km}%` }]}>
                KM
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.hrs}%` }]}>
                Hrs
              </Text>
              <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.amount}%` }]}>
                Amount (₹)
              </Text>
              <Text style={[styles.tableHeaderCell, { width: `${COL.status}%` }]}>Status</Text>
            </View>
            {data.entries.map((r, i) => (
              <View
                key={r.duty_slip_id + i}
                style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
                wrap={false}
              >
                <Text style={[styles.tableCell, { width: `${COL.slipNo}%` }]}>
                  {r.duty_slip_no}
                </Text>
                <Text style={[styles.tableCell, { width: `${COL.date}%` }]}>
                  {fmtDate(r.booking_date)}
                </Text>
                <Text style={[styles.tableCell, { width: `${COL.customer}%` }]}>
                  {r.customer_company_name
                    ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
                    : (r.customer_name ?? '—')}
                </Text>
                <Text style={[styles.tableCell, { width: `${COL.vehicle}%` }]}>
                  {r.vehicle_reg_no ?? '—'}
                </Text>
                <Text style={[styles.tableCell, { width: `${COL.dutyType}%` }]}>
                  {dutyTypeLabel(r.duty_type)}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.km}%` }]}>
                  {r.total_km != null ? fmtInt(r.total_km) : '—'}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.hrs}%` }]}>
                  {r.total_hours != null ? fmtNum(r.total_hours, 1) : '—'}
                </Text>
                <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.amount}%` }]}>
                  {fmtNum(r.total_amount)}
                </Text>
                <Text style={[styles.tableCell, { width: `${COL.status}%` }]}>
                  {r.status.toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Total — only when there are entries */}
        {data.entries.length > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>GRAND TOTAL</Text>
            <Text style={styles.totalValue}>₹ {fmtNum(data.total)}</Text>
          </View>
        ) : null}

        {/* Signature */}
        <View style={styles.sigRow}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLine1}>For {data.company.name}</Text>
            <Text style={styles.sigLine2}>Authorized Signatory</Text>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Duty Register Report  •  ${data.entries.length} slip(s)  •  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Text style={{ fontSize: 8.5, marginBottom: 1 }}>
      <Text style={{ fontFamily: 'Helvetica-Bold' }}>{label} </Text>
      <Text>{value ?? '—'}</Text>
    </Text>
  );
}

export default DutyRegisterReportPDF;
