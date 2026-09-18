import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

/**
 * VehicleList — per-vehicle CRUD with filter bar + modal-overlay form.
 *
 * Lives inside the Manage Vehicles tab of /master/utilities (TAXI-403).
 * Same RPC pattern as the rest of the M2/M3/M4 code: reads via
 * `list_vehicles_for_company`, writes via `add_vehicle` / `update_vehicle`
 * / `delete_vehicle`. PostgREST custom-schema workaround.
 *
 * Role gating (per TAXI-303 pattern): owner + operator see Add / Edit /
 * Delete buttons; accountant + viewer see a read-only filterable list.
 *
 * Filtering is client-side over the already-fetched list — adequate for
 * the scale (a single taxi company has dozens of vehicles, not millions).
 */

interface VehicleRow {
  id: number;
  registration_no: string;
  vehicle_group_id: number | null;
  vehicle_group_name: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  rc_expiry: string | null;
  insurance_no: string | null;
  insurance_expiry: string | null;
  permit_no: string | null;
  permit_expiry: string | null;
  is_active: boolean;
  notes: string | null;
}

interface VehicleGroup { id: number; name: string; display_order: number | null }
interface VehicleType  { id: number; name: string }

const EMPTY_VEHICLE: VehicleRow = {
  id: 0,
  registration_no: '',
  vehicle_group_id: null,
  vehicle_group_name: null,
  vehicle_type_id: null,
  vehicle_type_name: null,
  make: '',
  model: '',
  year: null,
  color: '',
  chassis_no: '',
  engine_no: '',
  rc_expiry: null,
  insurance_no: '',
  insurance_expiry: null,
  permit_no: '',
  permit_expiry: null,
  is_active: true,
  notes: '',
};

// Convert a yyyy-mm-dd <input type="date"> value to the ISO date Postgres expects.
// Empty string → null. Already-ISO values pass through.
function dateInputToIso(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function VehicleList() {
  const { companyId, role } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = role === 'owner' || role === 'operator';

  const [filterGroupId, setFilterGroupId] = useState<string>('all');
  const [filterTypeId, setFilterTypeId] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<string>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -- queries ----------------------------------------------------------------
  const vehiclesQuery = useQuery({
    queryKey: ['rpc', 'list_vehicles_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicles_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleRow[];
    },
  });

  // Re-use the same query keys ManageTaxonomy uses — TanStack dedupes
  // by key, so no extra round-trip.
  const groupsQuery = useQuery({
    queryKey: ['rpc', 'list_vehicle_groups_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_groups_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleGroup[];
    },
  });
  const typesQuery = useQuery({
    queryKey: ['rpc', 'list_vehicle_types_for_company', companyId ?? 'none'],
    enabled: companyId != null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('list_vehicle_types_for_company');
      if (e) throw e;
      return (data ?? []) as VehicleType[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['rpc', 'list_vehicles_for_company'] });

  // -- filtering --------------------------------------------------------------
  const filtered = useMemo(() => {
    const rows = vehiclesQuery.data ?? [];
    const search = filterSearch.trim().toUpperCase();
    return rows.filter((v) => {
      if (filterGroupId !== 'all' && String(v.vehicle_group_id ?? '') !== filterGroupId) return false;
      if (filterTypeId !== 'all' && String(v.vehicle_type_id ?? '') !== filterTypeId) return false;
      if (filterActive === 'active' && !v.is_active) return false;
      if (filterActive === 'inactive' && v.is_active) return false;
      if (search && !v.registration_no.toUpperCase().includes(search)) return false;
      return true;
    });
  }, [vehiclesQuery.data, filterGroupId, filterTypeId, filterActive, filterSearch]);

  // -- mutations --------------------------------------------------------------
  const openAdd = () => {
    setEditing(EMPTY_VEHICLE);
    setError(null);
    setModalOpen(true);
  };
  const openEdit = (v: VehicleRow) => {
    setEditing(v);
    setError(null);
    setModalOpen(true);
  };
  const closeModal = () => {
    if (busy) return;
    setModalOpen(false);
    setEditing(null);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const fd = new FormData(e.currentTarget);

    const regNo = String(fd.get('registration_no') ?? '').trim();
    const groupRaw = String(fd.get('vehicle_group_id') ?? '');
    const typeRaw = String(fd.get('vehicle_type_id') ?? '');
    const yearRaw = String(fd.get('year') ?? '').trim();

    if (!regNo) { setError('Registration number is required.'); return; }
    const groupId = groupRaw === '' ? null : Number(groupRaw);
    const typeId  = typeRaw  === '' ? null : Number(typeRaw);
    const year    = yearRaw === '' ? null : Number(yearRaw);
    if (year != null && Number.isNaN(year)) { setError('Year must be a number.'); return; }

    const payload = {
      p_registration_no:  regNo,
      p_vehicle_group_id: groupId,
      p_vehicle_type_id:  typeId,
      p_make:             String(fd.get('make') ?? ''),
      p_vehicle_model:    String(fd.get('model') ?? ''),
      p_year:             year,
      p_color:            String(fd.get('color') ?? ''),
      p_chassis_no:       String(fd.get('chassis_no') ?? ''),
      p_engine_no:        String(fd.get('engine_no') ?? ''),
      p_rc_expiry:        dateInputToIso(fd.get('rc_expiry')),
      p_insurance_no:     String(fd.get('insurance_no') ?? ''),
      p_insurance_expiry: dateInputToIso(fd.get('insurance_expiry')),
      p_permit_no:        String(fd.get('permit_no') ?? ''),
      p_permit_expiry:    dateInputToIso(fd.get('permit_expiry')),
      p_is_active:        fd.get('is_active') === 'on',
      p_notes:            String(fd.get('notes') ?? ''),
    };

    setBusy(true);
    const isNew = editing.id === 0;
    const rpcErr = isNew
      ? (await supabase.rpc('add_vehicle', payload)).error
      : (await supabase.rpc('update_vehicle', { p_id: editing.id, ...payload })).error;
    setBusy(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    setModalOpen(false);
    setEditing(null);
    await invalidate();
  };

  const handleDelete = async (v: VehicleRow) => {
    if (!window.confirm(`Delete vehicle "${v.registration_no}"?`)) return;
    const { error: rpcErr } = await supabase.rpc('delete_vehicle', { p_id: v.id });
    if (rpcErr) { window.alert(rpcErr.message); return; }
    await invalidate();
  };

  const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : '—');

  return (
    <section className="card" data-testid="vehicles-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Vehicles</h3>
        {canEdit && (
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Vehicle
          </button>
        )}
      </div>
      <p style={{ marginTop: 0 }}>
        Per-vehicle records — registration, group/type, expiries, documents.
      </p>

      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
          padding: '0.75rem',
          background: 'var(--color-surface-2)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="form-field" style={{ minWidth: '160px' }}>
          <label htmlFor="filter-group">Group</label>
          <select id="filter-group" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
            <option value="all">All groups</option>
            {groupsQuery.data?.map((g) => (
              <option key={g.id} value={String(g.id)}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="form-field" style={{ minWidth: '160px' }}>
          <label htmlFor="filter-type">Type</label>
          <select id="filter-type" value={filterTypeId} onChange={(e) => setFilterTypeId(e.target.value)}>
            <option value="all">All types</option>
            {typesQuery.data?.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="form-field" style={{ minWidth: '140px' }}>
          <label htmlFor="filter-active">Status</label>
          <select id="filter-active" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="form-field" style={{ flex: 1, minWidth: '180px' }}>
          <label htmlFor="filter-search">Search registration</label>
          <input
            id="filter-search"
            type="search"
            placeholder="e.g. DL 01"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
          />
        </div>
      </div>

      {vehiclesQuery.isLoading ? (
        <div className="loading"><span className="loading__spinner" aria-hidden="true" />Loading vehicles…</div>
      ) : vehiclesQuery.isError ? (
        <div className="form-error form-error--server" role="alert">
          Failed to load: {vehiclesQuery.error instanceof Error ? vehiclesQuery.error.message : 'unknown error'}
        </div>
      ) : !filtered.length ? (
        <p>{(vehiclesQuery.data ?? []).length === 0 ? 'No vehicles yet.' : 'No vehicles match the current filters.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Reg. No.</th>
                <th>Group</th>
                <th>Type</th>
                <th>Make / Model</th>
                <th>RC expiry</th>
                <th>Insurance</th>
                <th>Permit</th>
                <th>Active</th>
                {canEdit && <th style={{ width: '160px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} data-testid={`vehicle-row-${v.id}`} className={v.is_active ? '' : 'data-table__row--inactive'}>
                  <td>{v.registration_no}</td>
                  <td>{v.vehicle_group_name ?? '—'}</td>
                  <td>{v.vehicle_type_name ?? '—'}</td>
                  <td>{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{fmtDate(v.rc_expiry)}</td>
                  <td>{fmtDate(v.insurance_expiry)}</td>
                  <td>{fmtDate(v.permit_expiry)}</td>
                  <td>{v.is_active ? 'yes' : 'no'}</td>
                  {canEdit && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button type="button" className="btn" onClick={() => openEdit(v)}>Edit</button>
                        <button type="button" className="btn" onClick={() => void handleDelete(v)}>Delete</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && editing && (
        <VehicleFormModal
          initial={editing}
          busy={busy}
          error={error}
          groups={groupsQuery.data ?? []}
          types={typesQuery.data ?? []}
          onSubmit={handleSubmit}
          onCancel={closeModal}
        />
      )}
    </section>
  );
}

// -- Modal -------------------------------------------------------------------

interface VehicleFormModalProps {
  initial: VehicleRow;
  busy: boolean;
  error: string | null;
  groups: VehicleGroup[];
  types: VehicleType[];
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function VehicleFormModal({ initial, busy, error, groups, types, onSubmit, onCancel }: VehicleFormModalProps) {
  const isNew = initial.id === 0;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? 'Add vehicle' : `Edit vehicle ${initial.registration_no}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="card"
        style={{ maxWidth: '720px', width: '90%', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', position: 'relative' }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          style={{
            position: 'absolute', top: '0.5rem', right: '0.75rem',
            background: 'transparent', border: 'none', color: 'var(--color-text-muted)',
            fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1,
          }}
        >×</button>

        <h3 style={{ marginTop: 0 }}>{isNew ? 'Add vehicle' : `Edit ${initial.registration_no}`}</h3>

        <form onSubmit={onSubmit} className="auth-form" noValidate>
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Identity</legend>
            <div className="form-field">
              <label htmlFor="veh-reg">Registration number *</label>
              <input id="veh-reg" name="registration_no" type="text" defaultValue={initial.registration_no} required autoComplete="off" />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-group">Group</label>
                <select id="veh-group" name="vehicle_group_id" defaultValue={initial.vehicle_group_id ?? ''}>
                  <option value="">-- select group --</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-type">Type</label>
                <select id="veh-type" name="vehicle_type_id" defaultValue={initial.vehicle_type_id ?? ''}>
                  <option value="">-- select type --</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-make">Make</label>
                <input id="veh-make" name="make" type="text" defaultValue={initial.make ?? ''} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-model">Model</label>
                <input id="veh-model" name="model" type="text" defaultValue={initial.model ?? ''} />
              </div>
              <div className="form-field" style={{ width: '90px' }}>
                <label htmlFor="veh-year">Year</label>
                <input id="veh-year" name="year" type="number" inputMode="numeric" defaultValue={initial.year ?? ''} />
              </div>
              <div className="form-field" style={{ width: '110px' }}>
                <label htmlFor="veh-color">Color</label>
                <input id="veh-color" name="color" type="text" defaultValue={initial.color ?? ''} />
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Documents</legend>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-chassis">Chassis no.</label>
                <input id="veh-chassis" name="chassis_no" type="text" defaultValue={initial.chassis_no ?? ''} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-engine">Engine no.</label>
                <input id="veh-engine" name="engine_no" type="text" defaultValue={initial.engine_no ?? ''} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-insno">Insurance no.</label>
                <input id="veh-insno" name="insurance_no" type="text" defaultValue={initial.insurance_no ?? ''} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-permitno">Permit no.</label>
                <input id="veh-permitno" name="permit_no" type="text" defaultValue={initial.permit_no ?? ''} />
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Expiries</legend>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-rcexp">RC expiry</label>
                <input id="veh-rcexp" name="rc_expiry" type="date" defaultValue={initial.rc_expiry ?? ''} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-insexp">Insurance expiry</label>
                <input id="veh-insexp" name="insurance_expiry" type="date" defaultValue={initial.insurance_expiry ?? ''} />
              </div>
              <div className="form-field" style={{ flex: 1 }}>
                <label htmlFor="veh-permexp">Permit expiry</label>
                <input id="veh-permexp" name="permit_expiry" type="date" defaultValue={initial.permit_expiry ?? ''} />
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
            <legend style={{ padding: '0 0.4rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Status</legend>
            <div className="form-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input id="veh-active" name="is_active" type="checkbox" defaultChecked={initial.is_active} />
                <span>Active (uncheck to deactivate)</span>
              </label>
            </div>
            <div className="form-field">
              <label htmlFor="veh-notes">Notes</label>
              <textarea
                id="veh-notes"
                name="notes"
                rows={3}
                defaultValue={initial.notes ?? ''}
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

          {error && <div className="form-error form-error--server" role="alert">{error}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? <><span className="loading__spinner" aria-hidden="true" />Saving…</> : (isNew ? 'Save' : 'Save changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
