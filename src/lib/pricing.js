// Platform commission on standard and student bookings. Corporate/EAP
// bookings (sponsored by an EMPLOYER-type institution, or any institution
// type other than UNIVERSITY) are exempt — Mindora earns from those
// through a separate employer retainer, not a per-booking cut, so taking
// both would be double-dipping against the professional.
//
// 35% as of 2026-10-01, a founder decision made with the reasoning that
// online-only professionals carry far lower overhead than a typical
// marketplace rate assumes. Will not go below 25% once the product is
// validated — update this constant, not call sites, when that happens.
export const PLATFORM_TAKE_RATE = 0.35

// True when this booking's platform commission should be charged —
// i.e. everything except a corporate/EAP-sponsored session.
export function commissionApplies(institutionType) {
  return institutionType !== 'EMPLOYER' && institutionType !== 'HEALTHCARE_PROVIDER' && institutionType !== 'INSURER' && institutionType !== 'OTHER'
}

// feeKes is the professional's full listed fee for the session (what they
// receive before commission, regardless of who pays it — patient,
// institution, or a mix). Returns the platform's cut in KES, rounded.
export function calculatePlatformFeeKes(feeKes, institutionType) {
  if (!commissionApplies(institutionType)) return 0
  return Math.round(feeKes * PLATFORM_TAKE_RATE)
}