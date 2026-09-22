/**
 * numberToWordsIndian — M11 helper.
 *
 * Converts an integer amount of Rupees to its Indian-system
 * word form, e.g.:
 *   0          → "Zero"
 *   1          → "One"
 *   21         → "Twenty-one"
 *   1234       → "One thousand two hundred thirty-four"
 *   123456     → "One lakh twenty-three thousand four hundred fifty-six"
 *   12345678   → "One crore twenty-three lakh forty-five thousand six hundred seventy-eight"
 *   10000000   → "One crore"
 *
 * Indian numbering breaks at:
 *   ones, tens, hundred (3 digits), thousand (3),
 *   lakh (2 above thousand), crore (2 above lakh).
 *
 * We stop at crore — anything larger (arab / kharab) is rare
 * for a taxi bill.
 *
 * Pure function, no external deps. Verified by a Node smoke
 * script in the worklog for boundary cases.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety',
];

function threeDigitsToWords(n: number): string {
  // n in [0, 999]
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]}-${ONES[u]}`;
  }
  // 100..999
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r === 0 ? '' : ` ${threeDigitsToWords(r)}`;
  return `${ONES[h]} hundred${rest}`;
}

/**
 * Convert a non-negative integer amount of Rupees into its
 * Indian-system word form (no "Rupees" prefix, no "only" suffix).
 *
 * Per docs/billTemplate.pdf: an "AND" is inserted before the
 * trailing ones digit when the number is >= 100. Examples:
 *   1000   → "one thousand"
 *   1234   → "one thousand AND two hundred thirty-four"  ← AND before 234
 *   1001   → "one thousand AND one"
 *   12345  → "twelve thousand AND three hundred forty-five"
 *
 * Why the AND: the operator's actual bills in production use this
 * style ("RUPEES THIRTY FIVE THOUSAND AND ONE AND TWENTY PAISE
 * ONLY"). It matches Indian-English billing convention. Smaller
 * amounts (< 100) skip the AND because there's nothing for it to
 * separate from.
 *
 * @param n  amount in rupees; integer in [0, 99,99,99,999]
 *           (up to ~100 crore). Larger values fall back to
 *           a crore-only representation.
 * @returns  word string, lowercase, single-spaced, hyphenated tens.
 */
export function numberToWordsIndian(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 0) {
    return `minus ${numberToWordsIndian(-n)}`;
  }
  n = Math.floor(n);
  if (n === 0) return 'zero';
  if (n >= 100_00_00_000) {
    const crorePart = Math.floor(n / 1_00_00_000);
    const rest = n % 1_00_00_000;
    const restWords = rest === 0 ? '' : ` ${numberToWordsIndian(rest)}`;
    return `${numberToWordsIndian(crorePart)} crore${restWords}`;
  }

  const crore    = Math.floor(n / 1_00_00_000);
  const lakh     = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1_000);
  const rest     = n % 1_000;

  const parts: string[] = [];
  if (crore)    parts.push(`${numberToWordsIndian(crore)} crore`);
  if (lakh)     parts.push(`${numberToWordsIndian(lakh)} lakh`);
  if (thousand) parts.push(`${numberToWordsIndian(thousand)} thousand`);
  if (rest) {
    // Insert "AND" before the rest when the rest is < 100 (i.e.
    // it's a trailing ones/tens pair, not a hundreds+ value).
    // This matches the operator's actual bills — e.g.
    //   35001  → "thirty-five thousand AND one"
    //   1234   → "one thousand two hundred thirty-four"   (no AND)
    //   100001 → "one lakh AND one"
    const andPrefix =
      (parts.length > 0 && rest < 100) ? 'AND ' : '';
    parts.push(`${andPrefix}${threeDigitsToWords(rest)}`);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Convert a 0-99 integer (used for paise) into word form.
 * No "AND" insertion — paise is always 0-99 and rendered standalone
 * in the format "... AND twenty paise only".
 */
export function paiseToWords(n: number): string {
  const v = Math.floor(Math.max(0, Math.min(99, n)));
  if (v === 0) return 'zero';
  if (v < 20) return ONES[v];
  const t = Math.floor(v / 10);
  const u = v % 10;
  return u === 0 ? TENS[t] : `${TENS[t]}-${ONES[u]}`;
}

/**
 * Format a Rupee amount (may have paise) as a full "Rupees … only"
 * sentence per docs/billTemplate.pdf.
 *
 * Examples:
 *   1890         → "Rupees One thousand eight hundred ninety only"
 *   35001        → "Rupees Thirty-five thousand AND one only"
 *   35001.20     → "Rupees Thirty-five thousand AND one AND twenty paise only"
 *   0.50         → "Rupees Zero AND fifty paise only"
 *
 * @param amount  rupees (may be fractional). Negative values fall
 *               through with a "minus" prefix.
 */
export function rupeesInWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);

  const rupeePart = numberToWordsIndian(rupees);
  if (!rupeePart) return '';

  // Capitalize the first letter, leaving "AND" uppercased where it sits.
  const titledRupees =
    rupeePart.charAt(0).toUpperCase() + rupeePart.slice(1);

  let body: string;
  if (paise > 0) {
    const paiseWords = paiseToWords(paise);
    // Template style: "Rupees <words> AND <paise words> paise only"
    body = `Rupees ${titledRupees} AND ${paiseWords} paise only`;
  } else {
    body = `Rupees ${titledRupees} only`;
  }

  return negative ? `minus ${body}` : body;
}
