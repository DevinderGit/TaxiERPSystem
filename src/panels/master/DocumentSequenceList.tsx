import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

/**
 * DocumentSequenceList — manages master.document_sequences rows.
 *
 * Lives inside the Document No. Control tab of /master/utilities (TAXI-404).
 * Same RPC pattern as the rest of M4: reads via `list_document_sequences_for_company`,
 * writes via `add_document_sequence` / `update_document_sequence`.
 *
 * UX: each row has an "Edit" button that swaps the row into edit mode
 * (all cells become inputs), then "Save" / "Cancel". A successful save
 * briefly tints the row green so the operator sees the change persisted.
 *
 * Role gating: owner + operator see Edit + Add buttons; accountant + viewer
 * see a read-only table.
 */

interface DocSequence {
  id: number;
  sequence_key: string;
  prefix: string;
  suffix: string;
  next_value: number;
  padding_length: number;
  mode: 'auto' | 'manual';
  is_active: boolean;
}

export function DocumentSequenceList() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [editId, setEditId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);

  const query = useQuery({
    queryKey: ['rpc', 'list_document_sequences_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_document_sequences_for_company');
      if (e) throw e;
      return (data ?? []) as DocSequence[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['rpc', 'list_document_sequences_for_company'] });

  // Clear the green-flash highlight after 1.2s so the user sees the confirmation
  // but it doesn't linger.
  useEffect(() => {
    if (flashId == null) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const isActiveChecked = fd.getAll('is_active').includes('on');
    const payload = {
      p_sequence_key:   String(fd.get('sequence_key') ?? '').trim(),
      p_prefix:         String(fd.get('prefix') ?? ''),
      p_suffix:         String(fd.get('suffix') ?? ''),
      p_next_value:     Number(fd.get('next_value') ?? 1) || 1,
      p_padding_length: Number(fd.get('padding_length') ?? 4) || 4,
      p_mode:           String(fd.get('mode') ?? 'auto'),
      p_is_active:      isActiveChecked,
    };
    if (!payload.p_sequence_key) { setError('Sequence key is required.'); return; }
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('add_document_sequence', payload);
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setAddOpen(false);
    await invalidate();
  };

  const handleSave = async (row: DocSequence, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    // Checkbox semantics: HTML doesn't submit unchecked checkboxes, so we
    // add a hidden is_active=false sibling in the form. getAll('is_active')
    // returns ['false'] when unchecked, ['false','on'] when checked.
    const isActiveChecked = fd.getAll('is_active').includes('on');
    const payload = {
      p_id: row.id,
      p_prefix:         fd.has('prefix')         ? String(fd.get('prefix'))         : null,
      p_suffix:         fd.has('suffix')         ? String(fd.get('suffix'))         : null,
      p_next_value:     fd.has('next_value')     ? Number(fd.get('next_value'))     : null,
      p_padding_length: fd.has('padding_length') ? Number(fd.get('padding_length')) : null,
      p_mode:           fd.has('mode')           ? String(fd.get('mode'))           : null,
      p_is_active:      isActiveChecked,
    };
    setBusy(true);
    const { error: rpcErr } = await supabase.rpc('update_document_sequence', payload);
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setEditId(null);
    setFlashId(row.id);
    await invalidate();
  };

  return (
    <section className="card" data-testid="docseq-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Document Sequences</h3>
        {canEdit && !addOpen && (
          <button type="button" className="btn" onClick={() => { setAddOpen(true); setError(null); }}>
            Add Sequence
          </button>
        )}
      </div>
      <p style={{ marginTop: 0 }}>
        Prefix / suffix / next-value / padding for the document numbering triggers
        (<code>fn_assign_duty_slip_no</code>, future bill-issuing function).
      </p>

      {addOpen && canEdit && (
        <form
          onSubmit={handleAdd}
          className="auth-form"
          noValidate
          style={{ background: 'var(--color-surface-2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="form-field" style={{ flex: '1 1 160px' }}>
              <label htmlFor="new-seqkey">Sequence key *</label>
              <input id="new-seqkey" name="sequence_key" type="text" placeholder="e.g. receipt" required autoComplete="off" />
            </div>
            <div className="form-field" style={{ width: '110px' }}>
              <label htmlFor="new-prefix">Prefix</label>
              <input id="new-prefix" name="prefix" type="text" placeholder="RCP-" />
            </div>
            <div className="form-field" style={{ width: '110px' }}>
              <label htmlFor="new-suffix">Suffix</label>
              <input id="new-suffix" name="suffix" type="text" />
            </div>
            <div className="form-field" style={{ width: '90px' }}>
              <label htmlFor="new-next">Next</label>
              <input id="new-next" name="next_value" type="number" inputMode="numeric" defaultValue={1} min={1} />
            </div>
            <div className="form-field" style={{ width: '90px' }}>
              <label htmlFor="new-padding">Padding</label>
              <input id="new-padding" name="padding_length" type="number" inputMode="numeric" defaultValue={4} min={1} max={20} />
            </div>
            <div className="form-field" style={{ width: '110px' }}>
              <label htmlFor="new-mode">Mode</label>
              <select id="new-mode" name="mode" defaultValue="auto">
                <option value="auto">auto</option>
                <option value="manual">manual</option>
              </select>
            </div>
            <div className="form-field" style={{ width: '90px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                <input type="hidden" name="is_active" value="false" />
                <input id="new-active" name="is_active" type="checkbox" defaultChecked />
                <span>Active</span>
              </label>
            </div>
          </div>
          {error && <div className="form-error form-error--server" role="alert">{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <><span className="loading__spinner" aria-hidden="true" />Saving…</> : 'Save'}
            </button>
            <button type="button" className="btn" onClick={() => { setAddOpen(false); setError(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {query.isLoading ? (
        <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading sequences…</div>
      ) : query.isError ? (
        <div className="form-error form-error--server" role="alert">
          Failed to load: {query.error instanceof Error ? query.error.message : 'unknown error'}
        </div>
      ) : !query.data || query.data.length === 0 ? (
        <p>No sequences yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sequence key</th>
                <th>Prefix</th>
                <th>Suffix</th>
                <th style={{ width: '90px' }}>Next</th>
                <th style={{ width: '90px' }}>Padding</th>
                <th style={{ width: '100px' }}>Mode</th>
                <th style={{ width: '90px' }}>Active</th>
                {canEdit && <th style={{ width: '180px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {query.data.map((row) =>
                editId === row.id ? (
                  <tr key={row.id} data-testid={`docseq-edit-${row.id}`}>
                    <td colSpan={canEdit ? 8 : 7}>
                      <form onSubmit={(e) => void handleSave(row, e)} className="auth-form" noValidate style={{ gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                          <div className="form-field" style={{ flex: '1 1 140px' }}>
                            <label htmlFor={`edit-seqkey-${row.id}`} style={{ display: 'none' }}>Sequence key</label>
                            <input id={`edit-seqkey-${row.id}`} type="text" value={row.sequence_key} disabled readOnly style={{ opacity: 0.7 }} />
                          </div>
                          <div className="form-field" style={{ width: '100px' }}>
                            <label htmlFor={`edit-prefix-${row.id}`} style={{ display: 'none' }}>Prefix</label>
                            <input id={`edit-prefix-${row.id}`} name="prefix" type="text" defaultValue={row.prefix} />
                          </div>
                          <div className="form-field" style={{ width: '100px' }}>
                            <label htmlFor={`edit-suffix-${row.id}`} style={{ display: 'none' }}>Suffix</label>
                            <input id={`edit-suffix-${row.id}`} name="suffix" type="text" defaultValue={row.suffix} />
                          </div>
                          <div className="form-field" style={{ width: '80px' }}>
                            <label htmlFor={`edit-next-${row.id}`} style={{ display: 'none' }}>Next</label>
                            <input id={`edit-next-${row.id}`} name="next_value" type="number" defaultValue={row.next_value} min={1} />
                          </div>
                          <div className="form-field" style={{ width: '80px' }}>
                            <label htmlFor={`edit-padding-${row.id}`} style={{ display: 'none' }}>Padding</label>
                            <input id={`edit-padding-${row.id}`} name="padding_length" type="number" defaultValue={row.padding_length} min={1} max={20} />
                          </div>
                          <div className="form-field" style={{ width: '100px' }}>
                            <label htmlFor={`edit-mode-${row.id}`} style={{ display: 'none' }}>Mode</label>
                            <select id={`edit-mode-${row.id}`} name="mode" defaultValue={row.mode}>
                              <option value="auto">auto</option>
                              <option value="manual">manual</option>
                            </select>
                          </div>
                          <div className="form-field" style={{ width: '80px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                              {/* Hidden input so the form always has an
                                  is_active value; HTML checkboxes don't
                                  submit when unchecked. The handler checks
                                  getAll('is_active').includes('on') for
                                  the actual checkbox state. */}
                              <input type="hidden" name="is_active" value="false" />
                              <input name="is_active" type="checkbox" defaultChecked={row.is_active} />
                              <span style={{ fontSize: '0.85rem' }}>Active</span>
                            </label>
                          </div>
                          <button type="submit" className="btn btn--primary" disabled={busy}>
                            {busy ? '…' : 'Save'}
                          </button>
                          <button type="button" className="btn" onClick={() => { setEditId(null); setError(null); }} disabled={busy}>
                            Cancel
                          </button>
                        </div>
                        {error && <div className="form-error form-error--server" role="alert">{error}</div>}
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.id}
                    data-testid={`docseq-row-${row.id}`}
                    className={[
                      row.is_active ? '' : 'data-table__row--inactive',
                      flashId === row.id ? 'docseq-row--flash' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <td><code>{row.sequence_key}</code></td>
                    <td>{row.prefix || '—'}</td>
                    <td>{row.suffix || '—'}</td>
                    <td>{row.next_value}</td>
                    <td>{row.padding_length}</td>
                    <td>{row.mode}</td>
                    <td>{row.is_active ? 'yes' : 'no'}</td>
                    {canEdit && (
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button type="button" className="btn" onClick={() => { setEditId(row.id); setError(null); }}>
                            Edit
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Inline keyframes for the brief green-flash confirmation after a successful save.
          Scoped to this component so we don't pollute index.css. */}
      <style>{`
        @keyframes docseq-flash {
          0%   { background: rgba(34, 197, 94, 0.45); }
          100% { background: transparent; }
        }
        .docseq-row--flash { animation: docseq-flash 1.2s ease-out; }
      `}</style>
    </section>
  );
}
