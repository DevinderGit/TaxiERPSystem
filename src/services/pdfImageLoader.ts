/**
 * pdfImageLoader — M11 helper.
 *
 * `@react-pdf/renderer`'s `<Image>` component cannot reliably
 * follow short-lived Supabase signed URLs across multi-page renders
 * (URL expires during render; CORS headers on local Supabase Storage
 * are flaky). The standard fix is to fetch the image as a Blob and
 * convert it to a base64 data URI up-front, then pass the data URI
 * to the PDF template as a prop.
 *
 * Public surface:
 *   fetchCompanyLogoDataURI(companyId, logoPath)
 *     → string | null
 *
 * Returns null on:
 *   - logoPath is null/empty (no logo uploaded yet — caller renders
 *     a placeholder text instead)
 *   - any error during fetch/blob/decode (network, CORS, missing
 *     bucket, etc.) — never throws. The PDF must still render.
 */

import { supabase } from './supabaseClient';

const BUCKET = 'company-logos';

/**
 * Fetch the company logo as a base64 data URI suitable for
 * embedding in a React-PDF <Image src={...}>.
 *
 * @param _companyId  unused for now (kept in the signature so the
 *                    dev preview can log it; logo_path is already
 *                    tenant-scoped because it's a column on
 *                    core.companies which RLS-locks to the caller).
 * @param logoPath    the value of core.companies.logo_path
 *                    (e.g. "42/1700000000000.png").
 * @returns           data URI string ("data:image/png;base64,...")
 *                    or null if the logo can't be loaded.
 */
export async function fetchCompanyLogoDataURI(
  _companyId: number | null | undefined,
  logoPath: string | null | undefined,
): Promise<string | null> {
  if (!logoPath) return null;

  try {
    // Step 1: get a signed URL (default expiry: 60s; more than
    // enough for a single fetch).
    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(logoPath, 60);
    if (signErr || !signed?.signedUrl) return null;

    // Step 2: fetch as a Blob. Don't use supabase.storage.download
    // here — it requires the path to be addressable, which it is,
    // but `fetch` keeps the code symmetric with non-Supabase images
    // and lets us handle CORS / 404 / 500 uniformly.
    const resp = await fetch(signed.signedUrl);
    if (!resp.ok) return null;

    const blob = await resp.blob();
    if (!blob || blob.size === 0) return null;

    // Step 3: Blob → ArrayBuffer → base64 (browser path).
    // We use FileReader because it's the most portable across
    // browsers and works for any MIME type the Blob carries.
    const dataUri = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string' && result.startsWith('data:')) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      reader.readAsDataURL(blob);
    });

    return dataUri;
  } catch {
    // Never throw — PDF must render even if the logo is broken.
    return null;
  }
}
