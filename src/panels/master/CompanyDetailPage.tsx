import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';
import { INDIAN_STATES } from '../../lib/indianStates';

/**
 * Company Detail page — read + edit a single core.companies row.
 *
 * Route: /master/company (TAXI-301).
 *
 * The table sits in the `core` schema, which PostgREST 16.2 in this
 * Supabase CLI build refuses to expose via `db.schemas` in config.toml
 * (the same bug TAXI-205 worked around for User Management). So both
 * the read and the write go through public-schema RPCs:
 *   - public.get_company()    → returns the row for the caller's company
 *   - public.update_company()  → SECURITY DEFINER, COALESCE/NULLIF so
 *                                a NULL/empty arg preserves the old value.
 *                                Enforces "only owner/operator can edit"
 *                                in the function body (TAXI-303) so even
 *                                a determined accountant/viewer can't
 *                                bypass the SPA gate.
 *
 * Role gating (TAXI-303): owner + operator can edit; accountant + viewer
 * see the form read-only (fields disabled, Save button hidden, logo
 * upload disabled). All four roles still reach the page so that
 * read-only access works for accounting review and audit.
 */

interface CompanyRow {
  id: number;
  name: string;
  legal_name: string | null;
  owner_name: string | null;
  gstin: string | null;
  pan: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  is_active: boolean;
}

// -- Zod schema -----------------------------------------------------------
// - name / address_line1 / city / state / pincode are NOT NULL in DB → required.
// - gstin / pan / phone / email are nullable in DB → empty string allowed,
//   but if present must satisfy format checks.
// - We feed the empty default ('') into optional fields so the form is
//   controlled; on save, empty strings get translated back to NULL by
//   the RPC's NULLIF() guard.
const companySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  legal_name: z.string().optional().default(''),
  owner_name: z.string().optional().default(''),
  gstin: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) => v === '' || /^[0-9A-Z]{15}$/.test(v),
      'GSTIN must be 15 characters (A-Z, 0-9)',
    ),
  pan: z
    .string()
    .optional()
    .default('')
    .refine(
      (v) => v === '' || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
      'PAN must be 10 characters (e.g. ABCDE1234F)',
    ),
  address_line1: z.string().min(1, 'Address line 1 is required'),
  address_line2: z.string().optional().default(''),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  pincode: z
    .string()
    .min(1, 'Pincode is required')
    .regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  phone: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || v.replace(/\D/g, '').length >= 10, 'Phone must be at least 10 digits'),
  email: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email format is invalid'),
});

type CompanyForm = z.infer<typeof companySchema>;

// Empty defaults used by useForm so the form is usable before the RPC
// returns. Once data arrives, the useEffect below resets the form.
// Explicitly typed as CompanyForm (not CompanyRow) so the field types
// match the Zod output — `string | undefined`, not `string | null`.
const EMPTY_COMPANY: CompanyForm = {
  name: '',
  legal_name: '',
  owner_name: '',
  gstin: '',
  pan: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
};

// Logo constraints — also enforced server-side by storage.buckets.allowed_mime_types
// and storage.objects RLS policies (see migration 20260918173000).
const MAX_LOGO_BYTES = 1_048_576; // 1 MiB
const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png'] as const;

export function CompanyDetailPage() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const [submitState, setSubmitState] = useState<
    { tone: 'ok' | 'err'; text: string } | null
  >(null);

  // Logo preview state. logoUrl is a 1-hour signed URL fetched on demand;
  // we re-fetch every time logo_path changes (including right after upload).
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Per TAXI-303 spec: only owner + operator may edit. Accountant + viewer
  // see the form read-only (inputs disabled, Save hidden, upload blocked).
  // The backend RPC enforces the same rule (see migration 20260918180000)
  // so a determined accountant/viewer can't bypass the SPA gate.
  const canEdit = role === 'owner' || role === 'operator';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CompanyForm>({
    resolver: zodResolver(companySchema),
    mode: 'onSubmit',
    defaultValues: EMPTY_COMPANY,
  });

  const companyQuery = useQuery({
    queryKey: ['rpc', 'get_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_company');
      if (error) throw error;
      // RPC returns an array (RETURNS TABLE); take the first row.
      const rows = (data ?? []) as CompanyRow[];
      if (rows.length === 0) {
        throw new Error('No company record found for your user.');
      }
      return rows[0] as CompanyRow;
    },
  });

  // Repopulate the form once data arrives. Without this, RHF stays at
  // EMPTY_COMPANY and the user thinks the page is blank.
  useEffect(() => {
    if (companyQuery.data) {
      const c = companyQuery.data;
      reset({
        name: c.name ?? '',
        legal_name: c.legal_name ?? '',
        owner_name: c.owner_name ?? '',
        gstin: c.gstin ?? '',
        pan: c.pan ?? '',
        address_line1: c.address_line1 ?? '',
        address_line2: c.address_line2 ?? '',
        city: c.city ?? '',
        state: c.state ?? '',
        pincode: c.pincode ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
      });
    }
  }, [companyQuery.data, reset]);

  // Generate a fresh signed URL whenever the company's logo_path changes.
  // The bucket is private (storage.buckets.public = false), so the only
  // way to render the image in the SPA is via a time-limited signed URL.
  useEffect(() => {
    let cancelled = false;
    const path = companyQuery.data?.logo_path ?? null;
    if (!path) {
      setLogoUrl(null);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      const { data, error } = await supabase.storage
        .from('company-logos')
        .createSignedUrl(path, 3600);
      if (cancelled) return;
      if (error) {
        setLogoError(error.message);
        setLogoUrl(null);
      } else {
        setLogoError(null);
        setLogoUrl(data.signedUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyQuery.data?.logo_path]);

  const handleLogoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Always reset the input so picking the same file twice still triggers onChange.
    e.target.value = '';
    if (!file || companyId == null) return;

    setLogoError(null);
    if (!ALLOWED_LOGO_TYPES.includes(file.type as (typeof ALLOWED_LOGO_TYPES)[number])) {
      setLogoError('Only JPG and PNG allowed');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('File too large (max 1 MB)');
      return;
    }

    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${companyId}/${Date.now()}.${ext}`;

    setLogoBusy(true);
    const { error: uploadErr } = await supabase.storage
      .from('company-logos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadErr) {
      setLogoError(uploadErr.message);
      setLogoBusy(false);
      return;
    }
    const { error: rpcErr } = await supabase.rpc('update_company', {
      p_logo_path: path,
    });
    if (rpcErr) {
      setLogoError(rpcErr.message);
      setLogoBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'get_company'] });
    setLogoBusy(false);
  };

  const onSubmit = async (data: CompanyForm) => {
    setSubmitState(null);
    const payload = {
      p_name: data.name,
      p_legal_name: data.legal_name,
      p_owner_name: data.owner_name,
      p_gstin: data.gstin,
      p_pan: data.pan,
      p_address_line1: data.address_line1,
      p_address_line2: data.address_line2,
      p_city: data.city,
      p_state: data.state,
      p_pincode: data.pincode,
      p_phone: data.phone,
      p_email: data.email,
    };
    const { error } = await supabase.rpc('update_company', payload);
    if (error) {
      setSubmitState({ tone: 'err', text: error.message });
      return;
    }
    setSubmitState({ tone: 'ok', text: 'Company updated.' });
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'get_company'] });
  };

  if (companyQuery.isError) {
    return (
      <main className="app-main">
        <h1 className="page-title">
          Company <span className="page-title__accent">Detail</span>
        </h1>
        <div className="form-error form-error--server" role="alert">
          Failed to load company:{' '}
          {companyQuery.error instanceof Error
            ? companyQuery.error.message
            : 'unknown error'}
        </div>
      </main>
    );
  }

  // Read-only banner shown to accountant + viewer. Helpful UX cue so the
  // user understands the disabled state isn't a bug.
  const readOnlyReason =
    role === 'accountant'
      ? 'Your role (accountant) can view the company record but not edit it. Ask an owner or operator to make changes.'
      : role === 'viewer'
        ? 'Your role (viewer) can view the company record but not edit it.'
        : null;

  return (
    <main className="app-main">
      <Link to="/master" className="back-link">
        ← Back to Master
      </Link>
      <h1 className="page-title">
        Company <span className="page-title__accent">Detail</span>
      </h1>
      <p className="page-subtitle">
        Edit your company's identity, GSTIN, and address. State drives
        inter-state GST calculations on every bill — keep it accurate.
      </p>

      {readOnlyReason && (
        <div
          className="form-message"
          style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: 'var(--color-warning)',
            marginBottom: '1rem',
          }}
          role="status"
          data-testid="readonly-banner"
        >
          {readOnlyReason}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
        <section className="card card--accent">
          <h3>Identity</h3>
          <p>Legal name, GSTIN, and PAN appear on every bill and PDF.</p>

          <div className="form-field" style={{ marginTop: '1rem' }}>
            <label htmlFor="company-name">Company name *</label>
            <input
              id="company-name"
              type="text"
              autoComplete="organization"
              disabled={!canEdit}
              {...register('name')}
              aria-invalid={errors.name ? 'true' : 'false'}
            />
            {errors.name && <span className="form-error">{errors.name.message}</span>}
          </div>

          <div className="form-field">
            <label>Logo</label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.75rem',
                border: '1px dashed var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
              }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Company logo"
                  data-testid="logo-preview"
                  style={{
                    maxWidth: '180px',
                    maxHeight: '120px',
                    objectFit: 'contain',
                    background: '#fff',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px',
                  }}
                />
              ) : (
                <div
                  data-testid="logo-placeholder"
                  style={{
                    width: '180px',
                    height: '120px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-surface-2)',
                    color: 'var(--color-text-muted)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                  }}
                >
                  No logo uploaded
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {canEdit && (
                  <label className="btn" htmlFor="logo-input" style={{ cursor: 'pointer' }}>
                    {logoBusy ? (
                      <>
                        <span className="loading__spinner" aria-hidden="true" />
                        Uploading…
                      </>
                    ) : logoUrl ? (
                      'Replace Logo'
                    ) : (
                      'Upload Logo'
                    )}
                  </label>
                )}
                <input
                  id="logo-input"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleLogoChange}
                  disabled={!canEdit || logoBusy}
                  style={{ display: 'none' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  JPG or PNG · max 1 MB
                </span>
              </div>
            </div>
            {logoError && (
              <span className="form-error form-error--server" role="alert">
                {logoError}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="legal-name">Legal name</label>
            <input
              id="legal-name"
              type="text"
              autoComplete="off"
              disabled={!canEdit}
              {...register('legal_name')}
              aria-invalid={errors.legal_name ? 'true' : 'false'}
            />
            {errors.legal_name && (
              <span className="form-error">{errors.legal_name.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="owner-name">Owner / proprietor name</label>
            <input
              id="owner-name"
              type="text"
              autoComplete="name"
              disabled={!canEdit}
              {...register('owner_name')}
              aria-invalid={errors.owner_name ? 'true' : 'false'}
            />
            {errors.owner_name && (
              <span className="form-error">{errors.owner_name.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="gstin">GSTIN</label>
            <input
              id="gstin"
              type="text"
              autoComplete="off"
              maxLength={15}
              disabled={!canEdit}
              {...register('gstin')}
              aria-invalid={errors.gstin ? 'true' : 'false'}
              placeholder="15 alphanumeric characters"
            />
            {errors.gstin && <span className="form-error">{errors.gstin.message}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="pan">PAN</label>
            <input
              id="pan"
              type="text"
              autoComplete="off"
              maxLength={10}
              disabled={!canEdit}
              {...register('pan')}
              aria-invalid={errors.pan ? 'true' : 'false'}
              placeholder="10 characters (e.g. ABCDE1234F)"
            />
            {errors.pan && <span className="form-error">{errors.pan.message}</span>}
          </div>
        </section>

        <section className="card">
          <h3>Address &amp; contact</h3>
          <p>Appears in bill headers and PDF reports.</p>

          <div className="form-field" style={{ marginTop: '1rem' }}>
            <label htmlFor="addr1">Address line 1 *</label>
            <input
              id="addr1"
              type="text"
              autoComplete="address-line1"
              disabled={!canEdit}
              {...register('address_line1')}
              aria-invalid={errors.address_line1 ? 'true' : 'false'}
            />
            {errors.address_line1 && (
              <span className="form-error">{errors.address_line1.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="addr2">Address line 2</label>
            <input
              id="addr2"
              type="text"
              autoComplete="address-line2"
              disabled={!canEdit}
              {...register('address_line2')}
              aria-invalid={errors.address_line2 ? 'true' : 'false'}
            />
            {errors.address_line2 && (
              <span className="form-error">{errors.address_line2.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="city">City *</label>
            <input
              id="city"
              type="text"
              autoComplete="address-level2"
              disabled={!canEdit}
              {...register('city')}
              aria-invalid={errors.city ? 'true' : 'false'}
            />
            {errors.city && <span className="form-error">{errors.city.message}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="state">State *</label>
            <select
              id="state"
              disabled={!canEdit}
              {...register('state')}
              aria-invalid={errors.state ? 'true' : 'false'}
            >
              <option value="">-- select state --</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {errors.state && <span className="form-error">{errors.state.message}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="pincode">Pincode *</label>
            <input
              id="pincode"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              disabled={!canEdit}
              {...register('pincode')}
              aria-invalid={errors.pincode ? 'true' : 'false'}
            />
            {errors.pincode && (
              <span className="form-error">{errors.pincode.message}</span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              disabled={!canEdit}
              {...register('phone')}
              aria-invalid={errors.phone ? 'true' : 'false'}
            />
            {errors.phone && <span className="form-error">{errors.phone.message}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              disabled={!canEdit}
              {...register('email')}
              aria-invalid={errors.email ? 'true' : 'false'}
            />
            {errors.email && <span className="form-error">{errors.email.message}</span>}
          </div>
        </section>

        {submitState && (
          <div
            className={
              submitState.tone === 'ok'
                ? 'form-message form-message--ok'
                : 'form-error form-error--server'
            }
            role="status"
          >
            {submitState.text}
          </div>
        )}

        {canEdit && (
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="loading__spinner" aria-hidden="true" />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </button>
        )}
      </form>
    </main>
  );
}
