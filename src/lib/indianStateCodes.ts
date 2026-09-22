/**
 * indianStateCodes — M11 helper.
 *
 * Maps an Indian state / UT name (as stored in master.customers.state
 * and core.companies.state) to its 2-digit GST state code. Used by
 * BillPDF to render the "StateCode : 07" field that sits next to
 * the customer's GSTIN per docs/billTemplate.pdf.
 *
 * Source: the official GST state-code table published by the GSTN.
 * The codes are stable and don't change.
 *
 * Lookup is case-insensitive and tolerates the common abbreviations
 * ("TN" → Tamil Nadu, "MH" → Maharashtra, etc.).
 */

const NAME_TO_CODE: Readonly<Record<string, string>> = {
  'jammu & kashmir': '01',
  'jammu and kashmir': '01',
  'jk': '01',

  'himachal pradesh': '02',
  'hp': '02',

  'punjab': '03',
  'pb': '03',

  'chandigarh': '04',
  'ch': '04',

  'uttarakhand': '05',
  'uttaranchal': '05',
  'uk': '05',

  'haryana': '06',
  'hr': '06',

  'delhi': '07',
  'new delhi': '07',
  'dl': '07',

  'rajasthan': '08',
  'rj': '08',

  'uttar pradesh': '09',
  'up': '09',

  'bihar': '10',
  'br': '10',

  'sikkim': '11',
  'sk': '11',

  'arunachal pradesh': '12',
  'ar': '12',

  'nagaland': '13',
  'nl': '13',

  'manipur': '14',
  'mn': '14',

  'mizoram': '15',
  'mz': '15',

  'tripura': '16',
  'tr': '16',

  'meghalaya': '17',
  'ml': '17',

  'assam': '18',
  'as': '18',

  'west bengal': '19',
  'bengal': '19',
  'wb': '19',

  'jharkhand': '20',
  'jh': '20',

  'odisha': '21',
  'orissa': '21',
  'od': '21',

  'chhattisgarh': '22',
  'cg': '22',

  'madhya pradesh': '23',
  'mp': '23',

  'gujarat': '24',
  'gj': '24',

  'daman & diu': '25',
  'daman and diu': '25',
  'dd': '25',

  'dadra & nagar haveli': '26',
  'dadra and nagar haveli': '26',
  'dadra & nagar haveli and daman & diu': '26',
  'dn': '26',

  'maharashtra': '27',
  'mh': '27',

  'andhra pradesh': '37',  // post-2014 bifurcated state
  'ap': '37',

  'karnataka': '29',
  'ka': '29',

  'goa': '30',
  'ga': '30',

  'lakshadweep': '31',
  'ld': '31',

  'kerala': '32',
  'kl': '32',

  'tamil nadu': '33',
  'tn': '33',

  'puducherry': '34',
  'pondicherry': '34',
  'py': '34',

  'andaman & nicobar islands': '35',
  'andaman and nicobar islands': '35',
  'an': '35',

  'telangana': '36',
  'ts': '36',
};

/**
 * Look up the 2-digit GST state code for the given state name.
 * @param state  state / UT name as stored in the DB
 * @returns      the 2-digit code (e.g. "07" for Delhi), or null if unknown
 */
export function gstStateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  const key = state.trim().toLowerCase();
  return NAME_TO_CODE[key] ?? null;
}
