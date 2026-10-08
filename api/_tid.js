// api/_tid.js — Device Tenant ID from the organization name (Tenant ID Naming
// Scheme Specification). Shared by the registration form (live preview as the
// name is typed) and api/orgs.js (which re-derives it and is what counts), so
// both run the same code. Web Crypto: global in browsers and Node ≥ 19.
//
//   normalize   lowercase, keep only a-z 0-9, single spaces
//   filter      drop noise words; if that empties it, keep them
//   prefix      ≥3 words → acronym; otherwise the first word (≤12)
//   suffix      first 4 hex of SHA-256(normalized name)
//   "Laguna Lake Development Authority" → llda-add4
//
// Departure from the spec's sample code: for one or two words it joins them with
// '-' ("aquatech-int"), which breaks the spec's own format rule and its example
// "AquaTech International" → aquatech-…; the first word satisfies both. Spaces
// are collapsed before hashing so "AquaTech  Systems" can't dodge the duplicate
// check that "AquaTech Systems" would hit.
export const TID_FORMAT = /^[a-z0-9]{2,12}-[a-f0-9]{4}$/;
const NOISE = new Set(['inc', 'corp', 'corporation', 'llc', 'ltd', 'co', 'company', 'systems',
  'group', 'the', 'of', 'and', 'solutions', 'services']);

// null when the name has too few letters/digits to name anything.
export async function generateTid(orgName) {
  const raw = String(orgName ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const all = raw.split(/\s+/).filter(Boolean);
  const kept = all.filter((w) => !NOISE.has(w));
  const words = kept.length ? kept : all;
  let prefix = (words.length >= 3 ? words.map((w) => w[0]).join('') : words[0] ?? '').slice(0, 12);
  if (prefix.length < 2) prefix = all.join('').slice(0, 12);   // "X Corp" → xcorp
  if (prefix.length < 2) return null;
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const suffix = [...new Uint8Array(hash, 0, 2)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
}
