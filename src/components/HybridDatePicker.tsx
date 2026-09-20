import { useRef } from 'react';
import type { ChangeEvent } from 'react';

/**
 * HybridDatePicker — text input + Today button + 📅 calendar button.
 *
 * Operator's preferred pattern (TAX-602 polish). Combines:
 *  - Always-visible ISO text input (`YYYY-MM-DD`) the operator can type into
 *  - **Today** button that auto-fills with today's date
 *  - **📅** button that triggers the native browser calendar via
 *    `showPicker()` (Chrome/Edge/Firefox 101+/Safari 16+), with a focus+click
 *    fallback for older Safari.
 *
 * The hidden native `<input type="date">` is visually clipped to 1×1 px
 * (screen-reader and Tab-accessible, but not visually intrusive) so it
 * keeps the operator's keyboard Tab order familiar.
 *
 * Props:
 *   id       — DOM id (also used for the label `htmlFor`)
 *   label    — visible label text
 *   value    — current ISO date string (`YYYY-MM-DD`); empty string for unset
 *   onChange — receives the new ISO string
 *   disabled — disables every interactive piece
 *   testId   — optional `data-testid` for the Today button (used by tests)
 */

interface HybridDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  testId?: string;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HybridDatePicker({ id, label, value, onChange, disabled, testId }: HybridDatePickerProps) {
  const hiddenDateRef = useRef<HTMLInputElement>(null);

  const openCalendar = () => {
    const el = hiddenDateRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* fall through */ }
    }
    el.focus();
    el.click();
  };

  return (
    <div className="form-field" style={{ minWidth: '180px' }}>
      <label htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          pattern="\d{4}-\d{2}-\d{2}"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ flex: 1, minWidth: '110px' }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => onChange(todayISO())}
          disabled={disabled}
          data-testid={testId}
          aria-label="Set to today"
          title="Set to today"
          style={{ padding: '0.4rem 0.6rem' }}
        >
          Today
        </button>
        <button
          type="button"
          className="btn"
          onClick={openCalendar}
          disabled={disabled}
          aria-label="Pick date from calendar"
          title="Pick date from calendar"
          style={{ padding: '0.4rem 0.6rem', fontSize: '1rem' }}
        >
          📅
        </button>
        {/* Hidden native date input — the 📅 button calls showPicker() on
            it (or focuses+clicks as a Safari fallback). Its onChange writes
            into the same ISO string the visible text input uses. */}
        <input
          ref={hiddenDateRef}
          type="date"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
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
      {value && !/^\d{4}-\d{2}-\d{2}$/.test(value) && (
        <span className="form-error">
          Use YYYY-MM-DD format (e.g. {todayISO()})
        </span>
      )}
    </div>
  );
}
