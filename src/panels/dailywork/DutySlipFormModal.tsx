import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { HybridDatePicker } from '../../components/HybridDatePicker';

/**
 * DutySlipFormModal — Add / Edit a duty slip (TAXI-802, extended by
 * M8 operator follow-ups: TAXI-803 rate lookup; TAXI-804 flexible
 * popup with custom_rate_items).
 *
 * Two sections:
 *   - Booking Info: customer, vehicle, duty_type (3 options: local /
 *     outstation / flexible), booking_date (HybridDatePicker),
 *     booking_ref, guest_name, guest_phone, pickup_location, drop_location
 *   - Duty Info: duty_start_dt, duty_end_dt (native datetime-local),
 *     opening_km, closing_km, extra_km_amount, extra_hour_amount,
 *     night_halt_amount, driver_allowance, other_charges,
 *     other_charges_remarks, driver_name, driver_phone
 *
 * Live "Computed: X km, Y hours" preview under the Duty Info fieldset.
 * Zod validation mirrors the RPC's checks.
 * Status is auto-derived in the RPC.
 *
 * Flexible popup (TAX-804): when duty_type='flexible', we suppress the
 * rate preview and instead show a "Custom rates" sub-section with 3
 * columns (label, amount, total) and an "Add row" button. The operator
 * adds key/value pairs like "per km 4000", "dinner 3000". Live total
 * at the bottom. These items are stored in `custom_rate_items` JSONB
 * on operations.duty_slips via the create_duty_slip / update_duty_slip
 * RPCs; the RPC sums them up to compute base_amount.
 *
 * Role gating: form is read-only for accountant/viewer.
 */

interface CustomerLite { id: number; name: string; company_name: string | null; state: string; is_active: boolean }
interface VehicleLite  { id: number; registration_no: string; vehicle_group_id: number | null; vehicle_type_id: number | null; is_active: boolean }

export interface FlexibleItem { label: string; amount: number }

export interface DutySlipInitial {
  id: number;
  customer_id: number;
  vehicle_id: number;
  rate_id: number | null;
  duty_type: 'local' | 'outstation' | 'flexible';
  booking_date: string;
  booking_ref: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  pickup_location: string | null;
  drop_location: string | null;
  duty_start_dt: string;
  duty_end_dt: string | null;
  opening_km: number | null;
  closing_km: number | null;
  extra_km_amount: number | null;
  extra_hour_amount: number | null;
  night_halt_amount: number | null;
  driver_allowance: number | null;
  other_charges: number | null;
  other_charges_remarks: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  custom_rate_items: FlexibleItem[];
}

interface DutySlipFormModalProps {
  mode: 'add' | 'edit';
  initial?: DutySlipInitial | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}

const DUTY_TYPES = [
  { value: 'local',      label: 'Local (intra-state — CGST + SGST)' },
  { value: 'outstation', label: 'Outstation (inter-state — IGST)' },
  { value: 'flexible',   label: 'Flexible (operator enters custom rates)' },
] as const;

// RHF-friendly defaults: every field is a string ("" when unset).
const EMPTY_FORM = {
  customer_id:        '',
  vehicle_id:         '',
  duty_type:          'local',
  booking_date:        '',
  booking_ref:        '',
  guest_name:         '',
  guest_phone:        '',
  pickup_location:    '',
  drop_location:      '',
  duty_start_dt:      '',
  duty_end_dt:        '',
  opening_km:         '',
  closing_km:         '',
  extra_km_amount:    '',
  extra_hour_amount:  '',
  night_halt_amount:  '',
  driver_allowance:   '',
  other_charges:      '',
  other_charges_remarks: '',
  driver_name:        '',
  driver_phone:       '',
};

const formSchema = z.object({
  customer_id:        z.string().min(1, 'Customer is required'),
  vehicle_id:         z.string().min(1, 'Vehicle is required'),
  duty_type:          z.string().min(1, 'Duty type is required'),
  booking_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Booking date is required (YYYY-MM-DD)'),
  booking_ref:        z.string().optional().default(''),
  guest_name:         z.string().optional().default(''),
  guest_phone:        z.string().optional().default('').refine(
    (v) => v === '' || /^\d{10}$/.test(v),
    'Guest phone must be 10 digits',
  ),
  pickup_location:    z.string().optional().default(''),
  drop_location:      z.string().optional().default(''),
  duty_start_dt:      z.string().min(1, 'Duty start is required'),
  duty_end_dt:        z.string().optional().default('').refine(
    (v) => v === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v),
    'Duty end must be a valid datetime',
  ),
  opening_km:         z.string().optional().default('').refine(
    (v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0),
    'Opening km must be a non-negative number',
  ),
  closing_km:         z.string().optional().default('').refine(
    (v) => v === '' || !Number.isNaN(Number(v)),
    'Closing km must be a number',
  ),
  extra_km_amount:    z.string().optional().default('').refine((v) => v === '' || !Number.isNaN(Number(v)), 'Must be a number'),
  extra_hour_amount:  z.string().optional().default('').refine((v) => v === '' || !Number.isNaN(Number(v)), 'Must be a number'),
  night_halt_amount:  z.string().optional().default('').refine((v) => v === '' || !Number.isNaN(Number(v)), 'Must be a number'),
  driver_allowance:   z.string().optional().default('').refine((v) => v === '' || !Number.isNaN(Number(v)), 'Must be a number'),
  other_charges:      z.string().optional().default('').refine((v) => v === '' || !Number.isNaN(Number(v)), 'Must be a number'),
  other_charges_remarks: z.string().optional().default(''),
  driver_name:        z.string().optional().default(''),
  driver_phone:       z.string().optional().default('').refine(
    (v) => v === '' || /^\d{10}$/.test(v),
    'Driver phone must be 10 digits',
  ),
});

type DutySlipForm = z.infer<typeof formSchema>;

// Cross-field validations (TAXI-806): closing_km >= opening_km, and
// duty_end_dt > duty_start_dt. Both rules are "if both sides are
// present" — empty inputs skip the rule (the RPC handles them).
const crossFieldChecks = (data: DutySlipForm, ctx: z.RefinementCtx) => {
  const o = data.opening_km?.trim() ?? '';
  const c = data.closing_km?.trim() ?? '';
  if (o !== '' && c !== '') {
    const on = Number(o);
    const cn = Number(c);
    if (Number.isFinite(on) && Number.isFinite(cn) && cn < on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closing_km'],
        message: 'Closing km cannot be less than opening km',
      });
    }
  }
  const s = data.duty_start_dt?.trim() ?? '';
  const e = data.duty_end_dt?.trim() ?? '';
  if (s !== '' && e !== '') {
    const sn = new Date(s).getTime();
    const en = new Date(e).getTime();
    if (Number.isFinite(sn) && Number.isFinite(en) && en <= sn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['duty_end_dt'],
        message: 'Duty end must be after duty start',
      });
    }
  }
};

export function DutySlipFormModal({
  mode,
  initial,
  busy,
  onBusyChange,
  onClose,
  onSaved,
}: DutySlipFormModalProps) {
  const { role, companyId } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const customersQuery = useQuery({
    queryKey: ['rpc', 'list_customers_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_customers_for_company');
      if (e) throw e;
      return (data ?? []) as CustomerLite[];
    },
  });
  const vehiclesQuery = useQuery({
    queryKey: ['rpc', 'list_vehicles_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicles_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleLite[];
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [flexibleItems, setFlexibleItems] = useState<FlexibleItem[]>(initial?.custom_rate_items ?? []);
  const [flexibleError, setFlexibleError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DutySlipForm>({
    resolver: zodResolver(formSchema.superRefine(crossFieldChecks)),
    mode: 'onSubmit',
    defaultValues: EMPTY_FORM,
  });

  // Populate form when initial changes (mode='edit') or reset (mode='add').
  useEffect(() => {
    if (mode === 'edit' && initial) {
      reset({
        customer_id:        String(initial.customer_id ?? ''),
        vehicle_id:         String(initial.vehicle_id ?? ''),
        duty_type:          initial.duty_type,
        booking_date:        initial.booking_date ?? '',
        booking_ref:        initial.booking_ref ?? '',
        guest_name:         initial.guest_name ?? '',
        guest_phone:        initial.guest_phone ?? '',
        pickup_location:    initial.pickup_location ?? '',
        drop_location:      initial.drop_location ?? '',
        duty_start_dt:      isoToInput(initial.duty_start_dt),
        duty_end_dt:        isoToInput(initial.duty_end_dt),
        opening_km:         initial.opening_km == null ? '' : String(initial.opening_km),
        closing_km:         initial.closing_km == null ? '' : String(initial.closing_km),
        extra_km_amount:    initial.extra_km_amount == null ? '' : String(initial.extra_km_amount),
        extra_hour_amount:  initial.extra_hour_amount == null ? '' : String(initial.extra_hour_amount),
        night_halt_amount:  initial.night_halt_amount == null ? '' : String(initial.night_halt_amount),
        driver_allowance:   initial.driver_allowance == null ? '' : String(initial.driver_allowance),
        other_charges:      initial.other_charges == null ? '' : String(initial.other_charges),
        other_charges_remarks: initial.other_charges_remarks ?? '',
        driver_name:        initial.driver_name ?? '',
        driver_phone:       initial.driver_phone ?? '',
      });
      setFlexibleItems(initial.custom_rate_items ?? []);
    } else {
      reset(EMPTY_FORM);
      setFlexibleItems([]);
    }
  }, [mode, initial, reset]);

  const openingKm = watch('opening_km');
  const closingKm = watch('closing_km');
  const dutyStart = watch('duty_start_dt');
  const dutyEnd = watch('duty_end_dt');
  const customerId = watch('customer_id');
  const vehicleId = watch('vehicle_id');
  const dutyType = watch('duty_type');
  const bookingDate = watch('booking_date');

  const totalHours = (() => {
    if (!dutyStart || !dutyEnd) return null;
    const a = new Date(dutyStart);
    const b = new Date(dutyEnd);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
  })();

  const totalKm = useMemo(() => {
    const o = numOrNull(openingKm ?? '');
    const c = numOrNull(closingKm ?? '');
    if (o == null || c == null) return null;
    return Math.max(0, c - o);
  }, [openingKm, closingKm]);

  // Rate preview: only for non-flexible duty types.
  const ratePreviewQuery = useQuery({
    enabled:
      customerId !== '' &&
      vehicleId !== '' &&
      bookingDate !== '' &&
      dutyType !== '' &&
      dutyType !== 'flexible',
    queryKey: [
      'rpc',
      'lookup_rate_for_duty_slip',
      customerId,
      vehicleId,
      bookingDate,
      totalKm,
      totalHours,
    ],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('lookup_rate_for_duty_slip', {
        p_customer_id: Number(customerId),
        p_vehicle_id:  Number(vehicleId),
        p_booking_date: bookingDate,
        p_total_km:    totalKm,
        p_total_hours: totalHours,
      });
      if (e) throw e;
      const row = Array.isArray(data) ? data[0] : data;
      return row ?? null;
    },
  });

  const ratePreview = ratePreviewQuery.data;
  const rateMissing = ratePreviewQuery.isSuccess && ratePreview && ratePreview.found === false;

  // Flexible items helpers
  const flexibleTotal = flexibleItems.reduce((acc, i) => acc + (Number.isFinite(i.amount) ? i.amount : 0), 0);

  const addFlexibleItem = () => {
    setFlexibleError(null);
    setFlexibleItems((prev) => [...prev, { label: '', amount: 0 }]);
  };

  const removeFlexibleItem = (idx: number) => {
    setFlexibleItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateFlexibleLabel = (idx: number, label: string) =>
    setFlexibleItems((prev) => prev.map((it, i) => (i === idx ? { ...it, label } : it)));

  const updateFlexibleAmount = (idx: number, amount: number) =>
    setFlexibleItems((prev) => prev.map((it, i) => (i === idx ? { ...it, amount } : it)));

  const onSubmit = async (data: DutySlipForm) => {
    setSubmitError(null);

    if (!data.booking_date || !data.duty_start_dt) {
      setSubmitError('Booking date and duty start are required.');
      return;
    }
    if (data.duty_type === 'flexible') {
      if (flexibleItems.length === 0) {
        setSubmitError('Flexible duty type requires at least one custom rate row.');
        return;
      }
      if (flexibleItems.some((it) => !it.label.trim() || !Number.isFinite(it.amount) || it.amount < 0)) {
        setSubmitError('Each custom rate needs a non-empty label and a non-negative amount.');
        return;
      }
    }

    const dutyStartISO = data.duty_start_dt.length === 16
      ? `${data.duty_start_dt}:00`
      : data.duty_start_dt;

    const basePayload: Record<string, unknown> = {
      p_customer_id:           Number(data.customer_id),
      p_vehicle_id:            Number(data.vehicle_id),
      p_duty_type:             data.duty_type,
      p_booking_date:          data.booking_date,
      p_duty_start_dt:         dutyStartISO,
      p_duty_end_dt:           data.duty_end_dt
        ? (data.duty_end_dt.length === 16 ? `${data.duty_end_dt}:00` : data.duty_end_dt)
        : null,
      p_booking_ref:           data.booking_ref,
      p_guest_name:            data.guest_name,
      p_guest_phone:           data.guest_phone,
      p_pickup_location:       data.pickup_location,
      p_drop_location:         data.drop_location,
      p_opening_km:            numOrNull(data.opening_km),
      p_closing_km:            numOrNull(data.closing_km),
      p_extra_km_amount:       numOrNull(data.extra_km_amount),
      p_extra_hour_amount:     numOrNull(data.extra_hour_amount),
      p_night_halt_amount:     numOrNull(data.night_halt_amount),
      p_driver_allowance:      numOrNull(data.driver_allowance),
      p_other_charges:         numOrNull(data.other_charges),
      p_other_charges_remarks: data.other_charges_remarks,
      p_driver_name:           data.driver_name,
      p_driver_phone:          data.driver_phone,
    };
    if (data.duty_type === 'flexible') {
      basePayload.p_custom_rate_items = flexibleItems.map((it) => ({
        label: it.label.trim(),
        amount: Number(it.amount),
      }));
    }

    onBusyChange(true);
    const rpcErr = mode === 'add'
      ? (await supabase.rpc('create_duty_slip', basePayload)).error
      : (await supabase.rpc('update_duty_slip', { p_id: initial?.id, ...basePayload })).error;
    onBusyChange(false);

    if (rpcErr) { setSubmitError(rpcErr.message); return; }
    setActionNotice(mode === 'add' ? 'Duty slip created.' : 'Duty slip updated.');
    setTimeout(() => setActionNotice(null), 2000);
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_duty_slips_for_company'] });
    onSaved();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'add' ? 'New duty slip' : `Edit duty slip ${initial?.id ?? ''}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={() => { /* backdrop-click no longer closes; use Cancel/Save */ }}
    >
      <div
        className="card"
        style={{ maxWidth: '1080px', width: '95%', maxHeight: '92vh', overflowY: 'auto', padding: '1.5rem', position: 'relative' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          style={{
            position: 'absolute', top: '0.5rem', right: '0.75rem',
            background: 'transparent', border: 'none', color: 'var(--color-text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1,
          }}
        >×</button>

        <h3 style={{ marginTop: 0 }}>{mode === 'add' ? 'New duty slip' : `Edit duty slip`}</h3>

        {actionNotice && (
          <div className="form-message form-message--ok" role="status" style={{ marginBottom: '0.5rem' }}>
            {actionNotice}
          </div>
        )}
        {submitError && (
          <div className="form-error form-error--server" role="alert" style={{ marginBottom: '0.5rem' }}>
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
          {/* ====================== Booking Info ====================== */}
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Booking Info</legend>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="ds-customer">Customer *</label>
                <select
                  id="ds-customer"
                  disabled={!canEdit}
                  {...register('customer_id')}
                  aria-invalid={errors.customer_id ? 'true' : 'false'}
                >
                  <option value="">-- select a customer --</option>
                  {customersQuery.data
                    ?.filter((c) => c.is_active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.company_name ? ` (${c.company_name})` : ''} — {c.state}
                      </option>
                    ))}
                </select>
                {errors.customer_id && <span className="form-error">{errors.customer_id.message}</span>}
              </div>

              <div className="form-field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="ds-vehicle">Vehicle *</label>
                <select
                  id="ds-vehicle"
                  disabled={!canEdit}
                  {...register('vehicle_id')}
                  aria-invalid={errors.vehicle_id ? 'true' : 'false'}
                >
                  <option value="">-- select a vehicle --</option>
                  {vehiclesQuery.data
                    ?.filter((v) => v.is_active)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registration_no}
                      </option>
                    ))}
                </select>
                {errors.vehicle_id && <span className="form-error">{errors.vehicle_id.message}</span>}
              </div>

              <div className="form-field" style={{ flex: '1 1 180px' }}>
                <label htmlFor="ds-duty">Duty type *</label>
                <select
                  id="ds-duty"
                  disabled={!canEdit}
                  {...register('duty_type')}
                  aria-invalid={errors.duty_type ? 'true' : 'false'}
                >
                  {DUTY_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
                {errors.duty_type && <span className="form-error">{errors.duty_type.message}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <HybridDatePicker
                id="ds-booking-date"
                label="Booking date *"
                value={watch('booking_date')}
                onChange={(v) => {
                  setValue('booking_date', v, { shouldValidate: false, shouldDirty: true });
                }}
                testId="ds-booking-date-today"
              />
              <input type="hidden" {...register('booking_date')} />

              <div className="form-field" style={{ flex: '1 1 180px' }}>
                <label htmlFor="ds-ref">Booking ref</label>
                <input id="ds-ref" type="text" disabled={!canEdit} {...register('booking_ref')} placeholder="optional" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="ds-guest-name">Guest name</label>
                <input id="ds-guest-name" type="text" disabled={!canEdit} {...register('guest_name')} />
              </div>
              <div className="form-field" style={{ width: '160px' }}>
                <label htmlFor="ds-guest-phone">Guest phone</label>
                <input
                  id="ds-guest-phone"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  disabled={!canEdit}
                  {...register('guest_phone')}
                  aria-invalid={errors.guest_phone ? 'true' : 'false'}
                  placeholder="10 digits"
                />
                {errors.guest_phone && <span className="form-error">{errors.guest_phone.message}</span>}
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="ds-pickup">Pickup location</label>
              <input id="ds-pickup" type="text" disabled={!canEdit} {...register('pickup_location')} placeholder="e.g. IGI Airport T3" />
            </div>
            <div className="form-field">
              <label htmlFor="ds-drop">Drop location</label>
              <input id="ds-drop" type="text" disabled={!canEdit} {...register('drop_location')} placeholder="e.g. Hotel Andaz" />
            </div>
          </fieldset>

          {/* ====================== Duty Info ====================== */}
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Duty Info</legend>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ flex: '1 1 220px' }}>
                <label htmlFor="ds-start">Duty start *</label>
                <input
                  id="ds-start"
                  type="datetime-local"
                  disabled={!canEdit}
                  {...register('duty_start_dt')}
                  aria-invalid={errors.duty_start_dt ? 'true' : 'false'}
                />
                {errors.duty_start_dt && <span className="form-error">{errors.duty_start_dt.message}</span>}
              </div>
              <div className="form-field" style={{ flex: '1 1 220px' }}>
                <label htmlFor="ds-end">Duty end</label>
                <input
                  id="ds-end"
                  type="datetime-local"
                  disabled={!canEdit}
                  {...register('duty_end_dt')}
                  aria-invalid={errors.duty_end_dt ? 'true' : 'false'}
                />
                {errors.duty_end_dt && <span className="form-error">{errors.duty_end_dt.message}</span>}
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-open">Opening km</label>
                <input
                  id="ds-open"
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  {...register('opening_km')}
                />
                {errors.opening_km && <span className="form-error">{errors.opening_km.message}</span>}
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-close">Closing km</label>
                <input
                  id="ds-close"
                  type="number"
                  step="0.01"
                  disabled={!canEdit}
                  {...register('closing_km')}
                />
                {errors.closing_km && <span className="form-error">{errors.closing_km.message}</span>}
              </div>
            </div>

            {/* Live computed indicator */}
            <div
              data-testid="ds-computed"
              style={{
                margin: '0.5rem 0 0.75rem',
                padding: '0.5rem 0.75rem',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                color: 'var(--color-text-muted)',
              }}
            >
              <div>
                Computed:{' '}
                <strong style={{ color: 'var(--color-text)' }}>
                  {totalKm == null ? '—' : `${totalKm} km`}
                </strong>
                ,{' '}
                <strong style={{ color: 'var(--color-text)' }}>
                  {totalHours == null ? '—' : `${totalHours.toFixed(2)} hours`}
                </strong>
              </div>
              {dutyType === 'flexible' ? (
                <div style={{ marginTop: '0.25rem', fontStyle: 'italic' }}>
                  Flexible duty type — no rate lookup. Operator enters custom rates below.
                </div>
              ) : ratePreviewQuery.isLoading ? (
                <div style={{ marginTop: '0.25rem' }}>Looking up rate…</div>
              ) : rateMissing ? (
                <div
                  data-testid="ds-rate-missing"
                  style={{ marginTop: '0.25rem', color: 'var(--color-warning)', fontWeight: 600 }}
                >
                  ⚠ No rate configured for this customer/vehicle combo. Add one in Master → Rate Management.
                </div>
              ) : ratePreview && ratePreview.found ? (
                <div
                  data-testid="ds-rate-preview"
                  style={{ marginTop: '0.25rem' }}
                >
                  Rate preview: <strong>base ₹{Number(ratePreview.base_rate ?? 0).toFixed(2)}</strong>
                  {ratePreview.per_km_rate != null && Number(ratePreview.per_km_rate) > 0 && (
                    <> + ₹{Number(ratePreview.per_km_rate).toFixed(2)}/km</>
                  )}
                  {ratePreview.per_hour_rate != null && Number(ratePreview.per_hour_rate) > 0 && (
                    <> + ₹{Number(ratePreview.per_hour_rate).toFixed(2)}/hr</>
                  )}
                  {ratePreview.per_day_rate != null && Number(ratePreview.per_day_rate) > 0 && (
                    <> + ₹{Number(ratePreview.per_day_rate).toFixed(2)}/day</>
                  )}
                  {ratePreview.night_halt_rate != null && Number(ratePreview.night_halt_rate) > 0 && (
                    <> + ₹{Number(ratePreview.night_halt_rate).toFixed(2)}/night</>
                  )}
                  {ratePreview.driver_allowance != null && Number(ratePreview.driver_allowance) > 0 && (
                    <> + ₹{Number(ratePreview.driver_allowance).toFixed(2)}/day driver</>
                  )}
                  {' = '}
                  <strong>computed base ≈ ₹{Number(ratePreview.computed_base ?? 0).toFixed(2)}</strong>
                  {ratePreview.min_charge_applied && (
                    <span style={{ color: 'var(--color-warning)' }}> (min_charge floor applied)</span>
                  )}
                  {ratePreview.min_charge != null && Number(ratePreview.min_charge) > 0 && (
                    <span style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)' }}>
                      · min_charge ₹{Number(ratePreview.min_charge).toFixed(2)}
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-extra-km">Extra km ₹</label>
                <input id="ds-extra-km" type="number" step="0.01" disabled={!canEdit} {...register('extra_km_amount')} />
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-extra-hr">Extra hr ₹</label>
                <input id="ds-extra-hr" type="number" step="0.01" disabled={!canEdit} {...register('extra_hour_amount')} />
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-night">Night halt ₹</label>
                <input id="ds-night" type="number" step="0.01" disabled={!canEdit} {...register('night_halt_amount')} />
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-driver">Driver all. ₹</label>
                <input id="ds-driver" type="number" step="0.01" disabled={!canEdit} {...register('driver_allowance')} />
              </div>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="ds-other">Other ₹</label>
                <input id="ds-other" type="number" step="0.01" disabled={!canEdit} {...register('other_charges')} />
              </div>
            </div>

            <div className="form-field">
              <label htmlFor="ds-other-rem">Other charges remarks</label>
              <input id="ds-other-rem" type="text" disabled={!canEdit} {...register('other_charges_remarks')} placeholder="optional" />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ flex: '1 1 200px' }}>
                <label htmlFor="ds-driver-name">Driver name</label>
                <input id="ds-driver-name" type="text" disabled={!canEdit} {...register('driver_name')} />
              </div>
              <div className="form-field" style={{ width: '160px' }}>
                <label htmlFor="ds-driver-phone">Driver phone</label>
                <input
                  id="ds-driver-phone"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  disabled={!canEdit}
                  {...register('driver_phone')}
                  aria-invalid={errors.driver_phone ? 'true' : 'false'}
                  placeholder="10 digits"
                />
                {errors.driver_phone && <span className="form-error">{errors.driver_phone.message}</span>}
              </div>
            </div>
          </fieldset>

          {/* ====================== Flexible custom rates (TAX-804) ====================== */}
          {dutyType === 'flexible' && (
            <fieldset
              data-testid="ds-flexible-section"
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                marginTop: '0.5rem',
              }}
            >
              <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                Custom rates (flexible)
              </legend>
              <p style={{ marginTop: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                Add one row per charge line — e.g. "per km 4000", "dinner 3000".
                The total is stored on the duty slip as <code>base_amount</code>.
              </p>

              {/* Table header */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 140px 40px',
                  gap: '0.5rem',
                  padding: '0.25rem 0',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  fontSize: '0.85rem',
                }}
              >
                <div>Label</div>
                <div style={{ textAlign: 'right' }}>Amount ₹</div>
                <div style={{ textAlign: 'right' }}>Subtotal</div>
                <div />
              </div>

              {flexibleItems.map((it, idx) => (
                <div
                  key={idx}
                  data-testid={`ds-flexible-row-${idx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 140px 140px 40px',
                    gap: '0.5rem',
                    alignItems: 'center',
                    padding: '0.25rem 0',
                  }}
                >
                  <input
                    type="text"
                    placeholder="e.g. per km"
                    value={it.label}
                    onChange={(e) => updateFlexibleLabel(idx, e.target.value)}
                    disabled={!canEdit}
                    style={{
                      padding: '0.4rem 0.6rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={it.amount}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updateFlexibleAmount(idx, Number(e.target.value))}
                    disabled={!canEdit}
                    style={{
                      padding: '0.4rem 0.6rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      textAlign: 'right',
                    }}
                  />
                  <div style={{ textAlign: 'right', color: 'var(--color-text)' }}>
                    ₹{Number.isFinite(it.amount) ? it.amount.toFixed(2) : '0.00'}
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => removeFlexibleItem(idx)}
                    disabled={!canEdit}
                    aria-label="Remove row"
                    style={{ padding: '0.2rem 0.5rem' }}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '0.5rem',
                  marginTop: '0.25rem',
                  borderTop: '1px solid var(--color-border)',
                  fontWeight: 600,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={addFlexibleItem}
                  disabled={!canEdit}
                  data-testid="ds-flexible-add-row"
                >
                  + Add row
                </button>
                <div data-testid="ds-flexible-total" style={{ color: 'var(--color-text)' }}>
                  Total: ₹{flexibleTotal.toFixed(2)}
                </div>
              </div>

              {flexibleError && (
                <div className="form-error form-error--server" role="alert" style={{ marginTop: '0.5rem' }}>
                  {flexibleError}
                </div>
              )}
            </fieldset>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            {mode === 'edit' && (
              <button
                type="button"
                className="btn"
                data-testid="ds-print-btn"
                onClick={() => {
                  if (initial?.id == null) return;
                  // Pull the duty_slip_no from the get_duty_slip RPC.
                  (async () => {
                    const { data, error: e } = await supabase.rpc('get_duty_slip', { p_id: initial.id });
                    if (e || !data) { window.alert(e?.message ?? 'Could not load duty slip'); return; }
                    const row = Array.isArray(data) ? data[0] : data;
                    if (!row) return;
                    if (row.status === 'cancelled') {
                      window.alert('Cancelled duty slips cannot be printed.');
                      return;
                    }
                    const url = `/print-placeholder.html?duty_slip_no=${encodeURIComponent(row.duty_slip_no)}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  })();
                }}
                disabled={busy}
              >
                🖨 Print
              </button>
            )}
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <><span className="loading__spinner" aria-hidden="true" />Saving…</>
              ) : (
                mode === 'add' ? 'Create' : 'Save changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- helpers (top-level) -------------------------------------------------

function isoToInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : '';
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
