// Shared helpers for support groups: constants, pseudonyms, and the two
// text checks (contact details and crisis language).

export const CURRENT_GROUP_CONSENT_VERSION = 'v1'
export const MAX_GROUP_MESSAGE_LENGTH = 1500

export const SUBSTANCE_USE_DEFAULT_RULES =
  'Do not share where to get any substance, or how much to take or combine. ' +
  'Talk about how you are doing, not about buying or dosing. ' +
  'If you are in danger or have taken something harmful, call 999 or 112 now.'

const ADJECTIVES = [
  'Quiet', 'Gentle', 'Steady', 'Bright', 'Calm', 'Warm', 'Kind', 'Brave', 'Patient', 'Hopeful',
  'Still', 'Soft', 'Clear', 'Open', 'Rooted', 'Rising', 'Golden', 'Mellow', 'Sunlit', 'Wandering',
]

const NOUNS = [
  'Heron', 'Acacia', 'Baobab', 'Ibis', 'Kestrel', 'River', 'Lake', 'Savanna', 'Dune', 'Fig',
  'Sparrow', 'Weaver', 'Crane', 'Meadow', 'Hill', 'Dove', 'Cedar', 'Stream', 'Sunbird', 'Orchid',
]

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

// Random, friendly, and unrelated to the person. Uniqueness within a group
// is enforced by the database, so callers retry if two collide.
export function generatePseudonym() {
  const number = 10 + Math.floor(Math.random() * 90)
  return `${pick(ADJECTIVES)} ${pick(NOUNS)} ${number}`
}

function normalize(text) {
  return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ')
}

// --- Contact details -------------------------------------------------------
// Members must not be able to take a conversation private and outside the
// platform, the same principle as in-app messaging. This is a simple check,
// not a guarantee: someone determined can spell a number out in words.

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/
const LINK_PATTERN = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|org|net|co|ke|africa|io|me|info)\b/i
const PHONE_RUN_PATTERN = /\+?\d[\d\s().-]{7,}\d/g

export function containsContactDetails(text) {
  if (EMAIL_PATTERN.test(text) || LINK_PATTERN.test(text)) return true
  const runs = text.match(PHONE_RUN_PATTERN) || []
  return runs.some((run) => run.replace(/\D/g, '').length >= 9)
}

// --- Crisis language -------------------------------------------------------
// A safety NET, not a safety system. It misses misspellings, Sheng, and
// indirect language, so facilitator attention and the Report button remain
// the real protection. The Swahili phrases need review by a native speaker
// before real users rely on this.

const CRISIS_PATTERNS = [
  /\bkill(ing)? myself\b/,
  /\bend(ing)? my (own )?life\b/,
  /\btake my (own )?life\b/,
  /\bwant(ed)? to die\b/,
  /\bwanna die\b/,
  /\bsuicid(e|al)\b/,
  /\b(don'?t|do not) want to (live|be alive|be here)\b/,
  /\bbetter off dead\b/,
  /\bno reason to live\b/,
  /\bhurt(ing)? myself\b/,
  /\bself[- ]?harm\b/,
  /\bcan'?t go on\b/,
  // Swahili
  /\bnataka kufa\b/,
  /\bnataka kujiua\b/,
  /\bkujiua\b/,
  /\bnijiue\b/,
  /\bsitaki kuishi\b/,
  /\bnimechoka na maisha\b/,
]

export function containsCrisisLanguage(text) {
  const normalized = normalize(text)
  return CRISIS_PATTERNS.some((pattern) => pattern.test(normalized))
}