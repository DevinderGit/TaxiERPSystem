import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabaseClient';
import { INDIAN_STATES } from '../../lib/indianStates';

/**
 * CustomerFormModal — Add / Edit a master.customers row.
 *
 * Route: /master/customers (TAXI-502). Conditional Zod validation: when
 * client_type='company', company_name + gstin are required (gstin must
 * be 15 alphanumeric chars); when client_type='personal', both are
 * optional and the form hides the fields entirely so the operator
 * doesn't have to clear them before saving.
 *
 * client_type cannot be changed on an existing row (it would be a
 * delete + re-create) — the radio is disabled in edit mode.
 */

export interface CustomerRow {
  id: number;
  name: string;
  company_name: string | null;
  gstin: string | null;
  state: string;
  phone: string;
  client_type: 'company' | 'personal';
  is_active: boolean;
}

interface CustomerFormModalProps {
  mode: 'add' | 'edit';
  initial?: CustomerRow | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}

// ---- Zod schema -----------------------------------------------------------
const baseShape = {
  name: z.string().min(1, 'Name is required'),
  address_line1: z.string().optional().default(''),
  address_line2: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().min(1, 'State is required'),
  pincode: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) => v === '' || /^\d{6}$/.test(v),
      'Pincode must be 6 digits',
    ),
  phone: z
    .string()
    .min(1, 'Phone is required')
    .refine(
      (v) => v.replace(/\D/g, '').length >= 10,
      'Phone must be at least 10 digits',
    ),
  email: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email format is invalid',
    ),
  pan: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) => v === '' || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
      'PAN must be 10 characters (e.g. ABCDE1234F)',
    ),
  is_active: z.boolean().default(true),
  notes: z.string().optional().default(''),
};

const companySchema = z.object({
  client_type: z.literal('company'),
  ...baseShape,
  company_name: z.string().min(1, 'Company name is required for B2B clients'),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters'),
});

const personalSchema = z.object({
  client_type: z.literal('personal'),
  ...baseShape,
  company_name: z.string().optional().default(''),
  gstin: z.string().optional().default(''),
});

const schema = z.discriminatedUnion('client_type', [companySchema, personalSchema]);

type CustomerForm = z.infer<typeof schema>;

// Helper: produce the empty default for the add form. The literal satisfies
// the discriminated union (company requires company_name+gstin strings).
const EMPTY_FORM: CustomerForm = {
  client_type: 'company',
  name: '',
  company_name: '',
  gstin: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  pan: '',
  is_active: true,
  notes: '',
};

export function CustomerFormModal({
  mode,
  initial,
  busy,
  onBusyChange,
  onClose,
  onSaved,
}: CustomerFormModalProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerForm>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    defaultValues: EMPTY_FORM,
  });

  // Repopulate on open: in edit mode, hydrate from the row; in add mode,
  // clear to empty.
  useEffect(() => {
    if (mode === 'edit' && initial) {
      reset({
        client_type: initial.client_type,
        name: initial.name ?? '',
        company_name: initial.company_name ?? '',
        gstin: initial.gstin ?? '',
        address_line1: '',
        address_line2: '',
        city: '',
        state: initial.state ?? '',
        pincode: '',
        phone: initial.phone ?? '',
        email: '',
        pan: '',
        is_active: initial.is_active,
        notes: '',
      });
    } else {
      reset(EMPTY_FORM);
    }
  }, [mode, initial, reset]);

  const clientType = watch('client_type');
  const isPersonal = clientType === 'personal';

  const onSubmit = async (data: CustomerForm) => {
    onBusyChange(true);
    const payload = {
      p_client_type:   data.client_type,
      p_name:          data.name,
      p_company_name:  data.company_name || '',
      p_gstin:         data.gstin || '',
      p_address_line1: data.address_line1 || '',
      p_address_line2: data.address_line2 || '',
      p_city:          data.city || '',
      p_state:         data.state,
      p_pincode:       data.pincode || '',
      p_phone:         data.phone,
      p_email:         data.email || '',
      p_pan:           data.pan || '',
      p_is_active:     data.is_active,
      p_notes:         data.notes || '',
    };
    const isNew = mode === 'add';
    const rpcErr = isNew
      ? (await supabase.rpc('add_customer', payload)).error
      : (await supabase.rpc('update_customer', { p_id: initial?.id, ...payload })).error;
    onBusyChange(false);
    if (rpcErr) {
      // Surface via the standard form-error path: set a hidden error field
      // is awkward, so we alert instead. (RHF doesn't expose a global
      // setError easily without registering a phantom field.)
      alert(rpcErr.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_customers_for_company'] });
    onSaved();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'add' ? 'Add customer' : `Edit ${initial?.name ?? 'customer'}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        className="card"
        style={{ maxWidth: '720px', width: '90%', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', position: 'relative' }}
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

        <h3 style={{ marginTop: 0 }}>{mode === 'add' ? 'Add customer' : `Edit ${initial?.name ?? ''}`}</h3>

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Identity</legend>

            <div className="form-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ minWidth: '110px' }}>Client type</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    id="ct-company"
                    type="radio"
                    value="company"
                    disabled={mode === 'edit'}
                    {...register('client_type', {
                      onChange: (e) => {
                        // Mirror RHF's watch: switching back to company after
                        // touching the form is fine because the schema
                        // re-runs validation on submit. We just need to
                        // clear the personal-only state to keep Zod happy
                        // (the personal branch has optional empty strings,
                        // which are also valid for company — no clearing
                        // needed, the fields just become hidden).
                        if (e.target.value === 'company') {
                          // noop; company branch requires non-empty
                          // company_name + gstin, validation fires on submit.
                        }
                      },
                    })}
                  />
                  <label htmlFor="ct-company" style={{ cursor: 'pointer' }}>Company (B2B)</label>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <input
                    id="ct-personal"
                    type="radio"
                    value="personal"
                    disabled={mode === 'edit'}
                    {...register('client_type')}
                  />
                  <label htmlFor="ct-personal" style={{ cursor: 'pointer' }}>Personal</label>
                </span>
              </label>
              {mode === 'edit' && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', marginBottom: 0 }}>
                  client_type cannot be changed on an existing customer.
                </p>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="cust-name">Name *</label>
              <input id="cust-name" type="text" autoComplete="off" {...register('name')} aria-invalid={errors.name ? 'true' : 'false'} />
              {errors.name && <span className="form-error">{errors.name.message}</span>}
            </div>

            {!isPersonal && (
              <div className="form-field">
                <label htmlFor="cust-company">Company name *</label>
                <input id="cust-company" type="text" autoComplete="off" {...register('company_name')} aria-invalid={errors.company_name ? 'true' : 'false'} />
                {errors.company_name && <span className="form-error">{errors.company_name.message}</span>}
              </div>
            )}

            {!isPersonal && (
              <div className="form-field">
                <label htmlFor="cust-gstin">GSTIN *</label>
                <input
                  id="cust-gstin"
                  type="text"
                  autoComplete="off"
                  maxLength={15}
                  {...register('gstin')}
                  aria-invalid={errors.gstin ? 'true' : 'false'}
                  placeholder="15 alphanumeric characters"
                />
                {errors.gstin && <span className="form-error">{errors.gstin.message}</span>}
              </div>
            )}
          </fieldset>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Address</legend>

            <div className="form-field">
              <label htmlFor="cust-addr1">Address line 1</label>
              <input id="cust-addr1" type="text" autoComplete="address-line1" {...register('address_line1')} />
            </div>
            <div className="form-field">
              <label htmlFor="cust-addr2">Address line 2</label>
              <input id="cust-addr2" type="text" autoComplete="address-line2" {...register('address_line2')} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="cust-city">City</label>
                <input id="cust-city" type="text" autoComplete="address-level2" {...register('city')} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="cust-state">State *</label>
                <select id="cust-state" {...register('state')} aria-invalid={errors.state ? 'true' : 'false'}>
                  <option value="">-- select state --</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errors.state && <span className="form-error">{errors.state.message}</span>}
              </div>
              <div className="form-field" style={{ width: '110px' }}>
                <label htmlFor="cust-pincode">Pincode</label>
                <input
                  id="cust-pincode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={6}
                  {...register('pincode')}
                  aria-invalid={errors.pincode ? 'true' : 'false'}
                />
                {errors.pincode && <span className="form-error">{errors.pincode.message}</span>}
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Contact &amp; status</legend>

            <div className="form-field">
              <label htmlFor="cust-phone">Phone *</label>
              <input id="cust-phone" type="tel" autoComplete="tel" {...register('phone')} aria-invalid={errors.phone ? 'true' : 'false'} />
              {errors.phone && <span className="form-error">{errors.phone.message}</span>}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="cust-email">Email</label>
                <input id="cust-email" type="email" autoComplete="email" {...register('email')} aria-invalid={errors.email ? 'true' : 'false'} />
                {errors.email && <span className="form-error">{errors.email.message}</span>}
              </div>
              <div className="form-field" style={{ width: '150px' }}>
                <label htmlFor="cust-pan">PAN</label>
                <input
                  id="cust-pan"
                  type="text"
                  autoComplete="off"
                  maxLength={10}
                  {...register('pan')}
                  aria-invalid={errors.pan ? 'true' : 'false'}
                  placeholder="ABCDE1234F"
                />
                {errors.pan && <span className="form-error">{errors.pan.message}</span>}
              </div>
            </div>

            <div className="form-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input id="cust-active" type="checkbox" {...register('is_active')} />
                <span>Active (uncheck to deactivate)</span>
              </label>
            </div>

            <div className="form-field">
              <label htmlFor="cust-notes">Notes</label>
              <textarea
                id="cust-notes"
                rows={3}
                {...register('notes')}
                style={{
                  padding: '0.65rem 0.75rem',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  fontFamily: 'inherit',
                  fontSize: '0.95rem',
                  resize: 'vertical',
                }}
              />
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <><span className="loading__spinner" aria-hidden="true" />Saving…</>
              ) : (
                mode === 'add' ? 'Save' : 'Save changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
