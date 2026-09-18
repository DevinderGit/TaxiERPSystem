/**
 * Indian states and union territories for dropdowns.
 *
 * Used by:
 *  - TAXI-301 (Company Detail page) — company.state
 *  - TAXI-503 (Customer form)        — customer.state
 *
 * The seed company in core.companies has state='Delhi' so M7's
 * inter-state GST calculations have a baseline. The exact spelling
 * matters: master.fn_set_interstate (TAXI-106) compares customer.state
 * to company.state via DISTINCT, so the values here must match the
 * canonical English names the seed and UI use.
 *
 * Display order: 28 states first (alphabetical), then 8 UTs.
 * Sources: Constitution of India, Seventh Schedule + subsequent acts
 * creating new states/UTs (Telangana 2014, Ladakh 2019, J&K reorg 2019).
 */
export const INDIAN_STATES: readonly string[] = [
  // 28 states
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  // 8 union territories
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;
