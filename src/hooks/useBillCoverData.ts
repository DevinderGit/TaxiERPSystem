/**
 * useBillCoverData — M13 / TAXI-1301 shared types + hooks.
 *
 * Used by both the BillCoverReport page and the BillCoverReportPDF
 * template. Fetches via list_bill_cover_report RPC, applies the
 * client-side filter, exposes a print helper.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';

export interface BillCoverEntry {
  bill_id:               number;
  bill_no:               string;
  bill_date:             string;          // ISO YYYY-MM-DD
  status:                string;
  remarks:               string | null;
  base_amount:           number;
  extra_amount:          number;
  cgst_amount:           number;
  sgst_amount:           number;
  igst_amount:           number;
  total_tax:             number;
  total_after_tax:       number;
  round_off:             number;
  grand_total:           number;
  customer_id:           number;
  customer_name:         string | null;
  customer_company_name: string | null;
  customer_gstin:        string | null;
  customer_state:        string | null;
  duty_slip_count:       number;
  guest_names:           string;          // comma-separated
  created_at:            string;
}

export interface BillCoverFilters {
  customerName: string;
  guestName: string;
  fromDate: string;       // 'YYYY-MM-DD' or ''
  toDate: string;         // 'YYYY-MM-DD' or ''
}

export function useBillCoverQuery(companyId: number | null | undefined) {
  return useQuery({
    queryKey: ['rpc', 'list_bill_cover_report', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_bill_cover_report');
      if (e) throw e;
      return (data ?? []) as BillCoverEntry[];
    },
  });
}

/**
 * Apply the user's filter set to the entry list. All matches are
 * case-insensitive substring matches. Empty filters mean "no
 * constraint on this field".
 */
export function filterBillCover(
  entries: BillCoverEntry[],
  filters: BillCoverFilters,
): BillCoverEntry[] {
  const cust = filters.customerName.trim().toLowerCase();
  const guest = filters.guestName.trim().toLowerCase();
  const from = filters.fromDate;   // '' | YYYY-MM-DD
  const to   = filters.toDate;

  return entries.filter((r) => {
    if (cust) {
      const haystack = [
        r.customer_name ?? '',
        r.customer_company_name ?? '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(cust)) return false;
    }
    if (guest) {
      if (!(r.guest_names ?? '').toLowerCase().includes(guest)) return false;
    }
    if (from) {
      if (r.bill_date < from) return false;
    }
    if (to) {
      if (r.bill_date > to) return false;
    }
    return true;
  });
}

/** Sum of grand_total across the filtered set. */
export function totalGrand(entries: BillCoverEntry[]): number {
  return entries.reduce((acc, r) => acc + Number(r.grand_total ?? 0), 0);
}
