/**
 * useDutyRegisterData — M13 / TAXI-1303 shared types + helpers.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabaseClient';

export interface DutyRegisterEntry {
  duty_slip_id:          number;
  duty_slip_no:          string;
  booking_date:          string;
  duty_type:             string;
  status:                string;
  total_km:              number | null;
  total_hours:           number | null;
  base_amount:           number;
  total_amount:          number;
  bill_id:               number | null;
  bill_no:               string | null;
  bill_status:           string | null;
  customer_id:           number;
  customer_name:         string | null;
  customer_company_name: string | null;
  vehicle_id:            number;
  vehicle_reg_no:        string | null;
  created_at:            string;
}

export interface DutyRegisterFilters {
  customerId: string;     // '' for all, else customer_id as string
  vehicleId: string;      // '' for all, else vehicle_id as string
  status: string;         // 'all' / 'open' / 'closed' / 'billed' / 'cancelled'
  fromDate: string;       // '' or YYYY-MM-DD
  toDate: string;         // '' or YYYY-MM-DD
}

export function useDutyRegisterQuery(companyId: number | null | undefined) {
  return useQuery({
    queryKey: ['rpc', 'list_duty_register_report', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_duty_register_report');
      if (e) throw e;
      return (data ?? []) as DutyRegisterEntry[];
    },
  });
}

export function filterDutyRegister(
  entries: DutyRegisterEntry[],
  filters: DutyRegisterFilters,
): DutyRegisterEntry[] {
  return entries.filter((r) => {
    if (filters.customerId && String(r.customer_id) !== filters.customerId) return false;
    if (filters.vehicleId  && String(r.vehicle_id)  !== filters.vehicleId)  return false;
    if (filters.status && filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.fromDate && r.booking_date < filters.fromDate) return false;
    if (filters.toDate   && r.booking_date > filters.toDate)   return false;
    return true;
  });
}

/** Sortable column keys. */
export type DutyRegisterSortKey =
  | 'duty_slip_no' | 'booking_date' | 'customer' | 'vehicle'
  | 'duty_type' | 'total_km' | 'total_hours' | 'total_amount' | 'status';

export function sortDutyRegister(
  entries: DutyRegisterEntry[],
  key: DutyRegisterSortKey,
  dir: 'asc' | 'desc',
): DutyRegisterEntry[] {
  const mul = dir === 'asc' ? 1 : -1;
  const cmp = (a: DutyRegisterEntry, b: DutyRegisterEntry): number => {
    const av = pickValue(a, key);
    const bv = pickValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return mul * (av - bv);
    return mul * String(av).localeCompare(String(bv));
  };
  return [...entries].sort(cmp);
}

function pickValue(
  r: DutyRegisterEntry,
  key: DutyRegisterSortKey,
): string | number | null {
  switch (key) {
    case 'duty_slip_no':  return r.duty_slip_no;
    case 'booking_date':  return r.booking_date;
    case 'customer':      return r.customer_company_name || r.customer_name || '';
    case 'vehicle':       return r.vehicle_reg_no || '';
    case 'duty_type':     return r.duty_type;
    case 'total_km':      return r.total_km;
    case 'total_hours':   return r.total_hours;
    case 'total_amount':  return r.total_amount;
    case 'status':        return r.status;
  }
}
