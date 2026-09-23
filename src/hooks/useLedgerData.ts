/**
 * useLedgerData — M12 / TAXI-1201 shared types + numeric-tail helper.
 *
 * Both the LedgerBookPage and the LedgerPDF template share this
 * shape, so the page projects the RPC payload into LedgerEntry and
 * hands the filtered list straight to the PDF.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';

export interface LedgerEntry {
  id: number;
  bill_no: string;
  bill_date: string;          // ISO YYYY-MM-DD
  customer_id: number;
  customer_name: string | null;
  status: string;             // 'issued' | 'cancelled' | ...
  base_amount: number;
  extra_amount: number;
  grand_total: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  created_at: string;
}

/**
 * Extract the numeric tail of a bill_no like "BL-0045" → 45.
 * Anything before the last digit run is ignored. Used to compare
 * operator input "1" / "0001" / "45" against "BL-0001" / "BL-0045".
 *
 * Returns -1 if no digits present (so a non-matching bill sorts below
 * any real number).
 */
export function billNoNumericTail(billNo: string): number {
  const m = billNo.match(/(\d+)(?!.*\d)/);
  if (!m) return -1;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : -1;
}

/** Parse the operator's free-text input to a number. Empty → null. */
export function digitsToBillNoNumber(input: string): number | null {
  const cleaned = input.replace(/\D+/g, '');
  if (cleaned === '') return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick the preferred row per bill_no when the recycle-on-cancel
 * logic has produced duplicates. Prefer status='issued' over
 * 'cancelled'; among same-status, prefer the most recent id.
 */
export function dedupeByBillNo(rows: LedgerEntry[]): LedgerEntry[] {
  const map = new Map<string, LedgerEntry>();
  for (const r of rows) {
    const existing = map.get(r.bill_no);
    if (!existing) {
      map.set(r.bill_no, r);
      continue;
    }
    const existingIsCancelled = existing.status === 'cancelled';
    const rowIsCancelled      = r.status === 'cancelled';
    if (existingIsCancelled && !rowIsCancelled) {
      map.set(r.bill_no, r);
    } else if (existingIsCancelled === rowIsCancelled && r.id > existing.id) {
      map.set(r.bill_no, r);
    }
  }
  return Array.from(map.values());
}

/**
 * Filter rows by inclusive numeric-tail bill-number range.
 * Either bound may be null (= no bound).
 */
export function filterByBillNoRange(
  rows: LedgerEntry[],
  fromN: number | null,
  toN: number | null,
): LedgerEntry[] {
  if (fromN == null && toN == null) return rows;
  return rows.filter((r) => {
    const n = billNoNumericTail(r.bill_no);
    if (fromN != null && n < fromN) return false;
    if (toN   != null && n > toN)   return false;
    return true;
  });
}

/**
 * TanStack Query for the raw list. The page passes the result
 * through dedupeByBillNo + filterByBillNoRange before rendering.
 */
export function useLedgerQuery(companyId: number | null | undefined) {
  return useQuery({
    queryKey: ['rpc', 'list_ledger_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_ledger_for_company');
      if (e) throw e;
      return (data ?? []) as LedgerEntry[];
    },
  });
}
