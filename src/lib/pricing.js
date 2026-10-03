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

// The Student Rate tier: a lower commission on a lower, capped fee, for
// patients who've verified as a student or a young adult (18-25). See
// studentRate.routes.js for the verification flow itself.
export const STUDENT_RATE_TAKE_RATE = 0.25
export const STUDENT_RATE_FEE_CAP_KES = 2000

// True when this booking's platform commission should be charged —
// i.e. everything except a corporate/EAP-sponsored session.
export function commissionApplies(institutionType) {
  return institutionType !== 'EMPLOYER' && institutionType !== 'HEALTHCARE_PROVIDER' && institutionType !== 'INSURER' && institutionType !== 'OTHER'
}

// feeKes is the fee actually being charged for this session (the
// professional's full listed fee, or their Student Rate fee — the caller
// decides which, this function only decides the commission rate on top
// of it). Returns the platform's cut in KES, rounded.
export function calculatePlatformFeeKes(feeKes, institutionType, isStudentRate = false) {
  if (!commissionApplies(institutionType)) return 0
  const rate = isStudentRate ? STUDENT_RATE_TAKE_RATE : PLATFORM_TAKE_RATE
  return Math.round(feeKes * rate)
}