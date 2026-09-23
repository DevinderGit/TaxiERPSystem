/**
 * BillCoverReportPDF — M13 / TAXI-1301.
 *
 * Tabular PDF rendering of the Bill Cover Report (summary list
 * of bills with customer + duty-slip aggregates). Layout:
 *
 *   1. Company header    — 3-column: GSTIN/SAC/PAN + address + contact
 *   2. Title             — "BILL COVER REPORT" centered
 *   3. Filter context    — customer filter + date range + generated date
 *   4. Bill table        — bill_no | date | customer | guest | slip-count
 *                          | base+extra | tax | grand_total | status
 *   5. Total row         — sum of grand_total
 *
 * Render entry-points:
 *   pdf(<BillCoverReportPDF data={data} />).toBlob()   → inline iframe
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';

import type { BillCoverEntry } from '../../hooks/useBillCoverData';

export interface BillCoverPDFData {
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
    customerName: string;
    guestName: string;
    fromDate: string;       // 'YYYY-MM-DD' or ''
    toDate: string;         // 'YYYY-MM-DD' or ''
  };
  generatedAt: string;
  entries: BillCoverEntry[];
  total: number;
}

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
    paddingHorizontal: 30,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    color: COLORS.ink,
    lineHeight: 1.3,
  },

  invoiceHeading: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1,
  },
  companyNameHeading: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 8,
  },

  // 1. 3-column company header (same shape as BillPDF)
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

  // 3. Filter context block
  contextBlock: {
    marginBottom: 6,
  },
  contextLine: { fontSize: 8.5, marginBottom: 1 },
  contextLineBold: { fontFamily: 'Helvetica-Bold' },

  // 4. Bill table
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
  tableCell: {
    paddingHorizontal: 3,
    paddingVertical: 3,
    fontSize: 8.5,
  },
  tableCellRight: { textAlign: 'right' },

  // 5. Total row
  totalRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.band,
    borderTopWidth: 2,
    borderTopColor: '#facc15',
    borderTopStyle: 'solid',
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  totalLabel: {
    flex: 8,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    paddingRight: 8,
  },
  totalValue: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },

  // Signature
  sigRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
  },
  sigBlock: { width: 220, alignItems: 'center' },
  sigLine1: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sigLine2: { fontSize: 8.5, color: COLORS.inkMuted },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 30,
    right: 30,
    fontSize: 7.5,
    color: COLORS.inkLight,
    textAlign: 'center',
  },
});

const COL = {
  billNo:       11,
  date:         10,
  customer:     22,
  guest:        14,
  slipCount:     6,
  baseExtra:    11,
  tax:           9,
  amount:       12,
  status:        5,
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

function fmtNum(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function companyAddressLines(c: BillCoverPDFData['company']): string[] {
  const out: string[] = [];
  if (c.address_line1) out.push(c.address_line1);
  if (c.address_line2) out.push(c.address_line2);
  const tail = [c.city, c.state, c.pincode].filter(Boolean).join(', ');
  if (tail) out.push(tail);
  return out;
}

export function BillCoverReportPDF({ data }: { data: BillCoverPDFData }): ReactElement {
  const { filters } = data;
  return (
    <Document
      title="Bill Cover Report"
      author={data.company.name}
      subject="Bill Cover Report"
    >
      <Page size="A4" style={styles.page}>
        {/* ===== Title ===== */}
        <Text style={styles.invoiceHeading}>BILL COVER REPORT</Text>
        <Text style={styles.companyNameHeading}>{data.company.name}</Text>

        {/* ===== Company header ===== */}
        <View style={styles.headerRow}>
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
              <Text style={{ fontSize: 9 }}>Contact No.: {data.company.phone}</Text>
            ) : null}
            <View style={{ height: 6 }} />
            <Text style={styles.headerLabel}>Report</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>
              Bill Cover
            </Text>
          </View>
        </View>

        <View style={styles.hr} />

        {/* ===== Filter context ===== */}
        <View style={styles.contextBlock}>
          {filters.customerName ? (
            <Text style={styles.contextLine}>
              Customer: <Text style={styles.contextLineBold}>{filters.customerName}</Text>
            </Text>
          ) : null}
          {filters.guestName ? (
            <Text style={styles.contextLine}>
              Guest Name contains: <Text style={styles.contextLineBold}>"{filters.guestName}"</Text>
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
            Showing <Text style={styles.contextLineBold}>{data.entries.length}</Text> bill(s).
            Generated: <Text style={styles.contextLineBold}>{fmtDateTime(data.generatedAt)}</Text>
          </Text>
        </View>

        {/* ===== Bill table ===== */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { width: `${COL.billNo}%` }]}>Bill No</Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.date}%` }]}>Date</Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.customer}%` }]}>Customer</Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.guest}%` }]}>Guest</Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.slipCount}%` }]}>
              Slips
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.baseExtra}%` }]}>
              Base+Ext
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.tax}%` }]}>
              Tax
            </Text>
            <Text style={[styles.tableHeaderCell, styles.tableHeaderRight, { width: `${COL.amount}%` }]}>
              Amount (₹)
            </Text>
            <Text style={[styles.tableHeaderCell, { width: `${COL.status}%` }]}>St</Text>
          </View>
          {data.entries.map((r, i) => (
            <View
              key={r.bill_no + r.bill_id + i}
              style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              <Text style={[styles.tableCell, { width: `${COL.billNo}%` }]}>
                {r.bill_no}
              </Text>
              <Text style={[styles.tableCell, { width: `${COL.date}%` }]}>
                {fmtDate(r.bill_date)}
              </Text>
              <Text style={[styles.tableCell, { width: `${COL.customer}%` }]}>
                {r.customer_company_name
                  ? `${r.customer_company_name} (${r.customer_name ?? '—'})`
                  : (r.customer_name ?? '—')}
              </Text>
              <Text style={[styles.tableCell, { width: `${COL.guest}%` }]}>
                {r.guest_names || '—'}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.slipCount}%` }]}>
                {r.duty_slip_count}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.baseExtra}%` }]}>
                {fmtNum(r.base_amount + r.extra_amount)}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.tax}%` }]}>
                {fmtNum(r.total_tax)}
              </Text>
              <Text style={[styles.tableCell, styles.tableCellRight, { width: `${COL.amount}%` }]}>
                {fmtNum(r.grand_total)}
              </Text>
              <Text style={[styles.tableCell, { width: `${COL.status}%` }]}>
                {r.status === 'issued' ? 'I' :
                 r.status === 'cancelled' ? 'C' :
                 r.status[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          ))}
        </View>

        {/* ===== Total row ===== */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>GRAND TOTAL</Text>
          <Text style={styles.totalValue}>₹ {fmtNum(data.total)}</Text>
        </View>

        {/* ===== Signature ===== */}
        <View style={styles.sigRow}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLine1}>For {data.company.name}</Text>
            <Text style={styles.sigLine2}>Authorized Signatory</Text>
          </View>
        </View>

        {/* ===== Footer ===== */}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Bill Cover Report  •  ${data.entries.length} bill(s)  •  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

export default BillCoverReportPDF;
