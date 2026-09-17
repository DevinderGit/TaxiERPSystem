import { create } from 'zustand';

/**
 * Root Zustand store for ephemeral UI state that does NOT belong to a
 * server cache and does NOT live in a single component.
 *
 * Per Code Architecture spec §4.1 ("AuthProvider" / panel modules):
 *   "modal open/close, form drafts"
 *
 * Each panel can extend this with its own slice, but for now we only
 * expose modals used by the Duty Slip form (M8). Form drafts are
 * intentionally left to React Hook Form's per-component state — RHF
 * already owns draft lifecycle, persistence, and dirty tracking.
 *
 * Naming convention: `xxxOpen` for booleans, `xxxId` for the row the
 * modal is targeting, `openXxx` / `closeXxx` for the action pair.
 */

interface UIState {
  /** Duty Slip form modal — opened by the list page (TAXI-801) and the Edit button. */
  dutySlipModalOpen: boolean;
  /** Duty slip row being edited. `null` when creating a new slip. */
  dutySlipModalId: number | null;
  openDutySlipModal: (id?: number) => void;
  closeDutySlipModal: () => void;

  /** Billing form modal — opened by the Billing page (M9). */
  billingModalOpen: boolean;
  /** Customer id for whom the bill is being generated. */
  billingModalCustomerId: number | null;
  openBillingModal: (customerId: number) => void;
  closeBillingModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  dutySlipModalOpen: false,
  dutySlipModalId: null,
  openDutySlipModal: (id) => set({ dutySlipModalOpen: true, dutySlipModalId: id ?? null }),
  closeDutySlipModal: () => set({ dutySlipModalOpen: false, dutySlipModalId: null }),

  billingModalOpen: false,
  billingModalCustomerId: null,
  openBillingModal: (customerId) =>
    set({ billingModalOpen: true, billingModalCustomerId: customerId }),
  closeBillingModal: () => set({ billingModalOpen: false, billingModalCustomerId: null }),
}));
