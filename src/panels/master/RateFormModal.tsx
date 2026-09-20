import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabaseClient';

/**
 * RateFormModal — Add a new rate for the currently-selected customer.
 *
 * Route: /master/rates (TAXI-602).
 *
 * - Selects vehicle_group, vehicle_type, duty_type, effective_from (date).
 * - 9 rate fields (base_rate required, others optional). Per MTP step 11,
 *   selecting duty_type='flexible' hides the entire rate-fields section
 *   (flexible has no rate card — operator types a custom amount per slip).
 * - Per MTP step 6 (uniqueness, lands in TAXI-604): the DB UNIQUE
 *   constraint catches dup inserts; the RPC surfaces the friendly
 *   message via the standard error path.
 *
 * Editing an existing rate is NOT done via this modal — that's inline
 * cell edit (per MTP step 7). See RateManagementPage's handleCellSave.
 */

interface RateFormModalProps {
  customerId: number;
  groups: { id: number; name: string }[];
  types: { id: number; name: string }[];
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function RateFormModal({
  customerId,
  groups,
  types,
  busy,
  onBusyChange,
  onClose,
  onSaved,
}: RateFormModalProps) {
  const queryClient = useQueryClient();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayISO());
  const [error, setError] = useState<string | null>(null);
  // Per operator directive (M6 + M8 follow-up): duty_type is no longer
  // selected on the Add/Edit Rate form. Rates are per (customer, vehicle)
  // only; duty_type is picked on the duty slip form. We still send
  // p_duty_type: 'local' on the wire so the legacy RPC signature stays
  // compatible (add_rate accepts it as NULL too).
  const [dutyType] = useState<string>('local');

  // Open the native date picker on browsers that support showPicker() (Chrome/Edge/Firefox 101+);
  // fall back to focus+click for older Safari.
  const openCalendar = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
    el.click();
  };

  const handleSubmit = async (_e: FormEvent<HTMLFormElement>) => {
    _e.preventDefault();
    setError(null);
    const fd = new FormData(_e.currentTarget);

    const numOrNull = (k: string) => {
      const raw = String(fd.get(k) ?? '').trim();
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    // For flexible duty type, base_rate is still NOT NULL in the schema.
    // We pass 0 — the duty slip form (M8) will override this anyway.
    // This matches TAXI-605's spec note.
    const base_rate = numOrNull('base_rate');

    const payload = {
      p_customer_id:      customerId,
      p_vehicle_group_id: Number(fd.get('vehicle_group_id') ?? ''),
      p_vehicle_type_id:  Number(fd.get('vehicle_type_id') ?? ''),
      p_duty_type:        dutyType,
      p_base_rate:        base_rate,
      p_per_km_rate:      numOrNull('per_km_rate'),
      p_per_hour_rate:    numOrNull('per_hour_rate'),
      p_per_day_rate:     numOrNull('per_day_rate'),
      p_extra_hour_rate:  numOrNull('extra_hour_rate'),
      p_extra_km_rate:    numOrNull('extra_km_rate'),
      p_night_halt_rate:  numOrNull('night_halt_rate'),
      p_driver_allowance: numOrNull('driver_allowance'),
      p_min_charge:       numOrNull('min_charge'),
      p_effective_from:   effectiveFrom,
    };

    onBusyChange(true);
    const { error: rpcErr } = await supabase.rpc('add_rate', payload);
    onBusyChange(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    await queryClient.invalidateQueries({ queryKey: ['rpc', 'list_rates_for_customer'] });
    onSaved();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add rate"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={() => { /* backdrop-click no longer closes; use Cancel/Save */ }}
    >
      <div
        className="card"
        style={{ maxWidth: '1080px', width: '90%', maxHeight: '92vh', overflowY: 'auto', padding: '1.5rem', position: 'relative' }}
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

        <h3 style={{ marginTop: 0 }}>Add rate</h3>

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="form-field" style={{ flex: 1 }}>
              <label htmlFor="rate-group">Vehicle group</label>
              <select id="rate-group" name="vehicle_group_id" required>
                <option value="">-- select group --</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="form-field" style={{ flex: 1 }}>
              <label htmlFor="rate-type">Vehicle type</label>
              <select id="rate-type" name="vehicle_type_id" required>
                <option value="">-- select type --</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="rate-from">Effective from (YYYY-MM-DD)</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
              <input
                id="rate-from"
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                pattern="\d{4}-\d{2}-\d{2}"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                required
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setEffectiveFrom(todayISO())}
                data-testid="rate-today-btn"
              >
                Today
              </button>
              <button
                type="button"
                className="btn"
                onClick={openCalendar}
                data-testid="rate-calendar-btn"
                aria-label="Pick date from calendar"
                title="Pick date from calendar"
                style={{ padding: '0.45rem 0.7rem', fontSize: '1rem' }}
              >
                📅
              </button>
              {/* Hidden native date input — the Calendar button calls showPicker()
                  on it (or focuses+clicks as a Safari fallback). Its onChange
                  feeds the visible text input. */}
              <input
                ref={dateInputRef}
                type="date"
                value={effectiveFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEffectiveFrom(e.target.value)}
                tabIndex={-1}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  width: '1px', height: '1px',
                  padding: 0, margin: '-1px',
                  overflow: 'hidden',
                  clip: 'rect(0,0,0,0)',
                  border: 0,
                }}
              />
            </div>
            {effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && (
              <span className="form-error">
                Use YYYY-MM-DD format (e.g. {todayISO()})
              </span>
            )}
          </div>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Rate fields</legend>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ width: '140px' }}>
                <label htmlFor="rate-base">Base rate *</label>
                <input id="rate-base" name="base_rate" type="number" step="0.01" min="0" required />
              </div>
              <div className="form-field" style={{ width: '110px' }}>
                <label htmlFor="rate-perkm">/km</label>
                <input id="rate-perkm" name="per_km_rate" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '110px' }}>
                <label htmlFor="rate-perhr">/hr</label>
                <input id="rate-perhr" name="per_hour_rate" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '110px' }}>
                <label htmlFor="rate-perday">/day</label>
                <input id="rate-perday" name="per_day_rate" type="number" step="0.01" min="0" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div className="form-field" style={{ width: '130px' }}>
                <label htmlFor="rate-exh">Extra /hr</label>
                <input id="rate-exh" name="extra_hour_rate" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '130px' }}>
                <label htmlFor="rate-exkm">Extra /km</label>
                <input id="rate-exkm" name="extra_km_rate" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '130px' }}>
                <label htmlFor="rate-night">Night halt</label>
                <input id="rate-night" name="night_halt_rate" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '130px' }}>
                <label htmlFor="rate-driver">Driver allowance</label>
                <input id="rate-driver" name="driver_allowance" type="number" step="0.01" min="0" />
              </div>
              <div className="form-field" style={{ width: '130px' }}>
                <label htmlFor="rate-min">Min charge</label>
                <input id="rate-min" name="min_charge" type="number" step="0.01" min="0" />
              </div>
            </div>
          </fieldset>

          {error && <div className="form-error form-error--server" role="alert">{error}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? (
                <><span className="loading__spinner" aria-hidden="true" />Saving…</>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
