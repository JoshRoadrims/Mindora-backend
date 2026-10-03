// Validated screening instruments: PHQ-9 (depression), GAD-7 (anxiety),
// and CAGE-AID (substance use) — 20 questions total. Replaces the earlier
// custom 10-question check-in with real, published clinical tools.
//
// Cutoffs here are the standard, published thresholds for each instrument,
// not invented for Mindora. They still need sign-off from a clinical
// reviewer before this is relied on with real patients — these are
// screening tools, not diagnostic ones, and Mindora should never claim
// otherwise to a user.

export const FREQUENCY_OPTIONS = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
]

export const YES_NO_OPTIONS = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
]

// id format: "<instrument>_<number>", matches CheckInAnswer.questionId.
// domain matches CheckInAnswer.domain, used to group answers back into
// per-instrument scores when reading a check-in back.
export const SCREENING_QUESTIONS = [
  // --- PHQ-9 (depression) ---
  { id: 'phq9_1', domain: 'PHQ9', scale: 'frequency', prompt: 'Little interest or pleasure in doing things' },
  { id: 'phq9_2', domain: 'PHQ9', scale: 'frequency', prompt: 'Feeling down, depressed, or hopeless' },
  { id: 'phq9_3', domain: 'PHQ9', scale: 'frequency', prompt: 'Trouble falling or staying asleep, or sleeping too much' },
  { id: 'phq9_4', domain: 'PHQ9', scale: 'frequency', prompt: 'Feeling tired or having little energy' },
  { id: 'phq9_5', domain: 'PHQ9', scale: 'frequency', prompt: 'Poor appetite or overeating' },
  { id: 'phq9_6', domain: 'PHQ9', scale: 'frequency', prompt: 'Feeling bad about yourself — or that you are a failure, or have let yourself or your family down' },
  { id: 'phq9_7', domain: 'PHQ9', scale: 'frequency', prompt: 'Trouble concentrating on things, such as reading or watching television' },
  { id: 'phq9_8', domain: 'PHQ9', scale: 'frequency', prompt: 'Moving or speaking so slowly that other people could have noticed — or the opposite, being so fidgety or restless that you have been moving around a lot more than usual' },
  // Item 9 is the safety item — handled specially in scoreCheckIn below,
  // never averaged away with the others.
  { id: 'phq9_9', domain: 'PHQ9', scale: 'frequency', prompt: 'Thoughts that you would be better off dead, or of hurting yourself in some way', isSafetyItem: true },

  // --- GAD-7 (anxiety) ---
  { id: 'gad7_1', domain: 'GAD7', scale: 'frequency', prompt: 'Feeling nervous, anxious, or on edge' },
  { id: 'gad7_2', domain: 'GAD7', scale: 'frequency', prompt: 'Not being able to stop or control worrying' },
  { id: 'gad7_3', domain: 'GAD7', scale: 'frequency', prompt: 'Worrying too much about different things' },
  { id: 'gad7_4', domain: 'GAD7', scale: 'frequency', prompt: 'Trouble relaxing' },
  { id: 'gad7_5', domain: 'GAD7', scale: 'frequency', prompt: 'Being so restless that it is hard to sit still' },
  { id: 'gad7_6', domain: 'GAD7', scale: 'frequency', prompt: 'Becoming easily annoyed or irritable' },
  { id: 'gad7_7', domain: 'GAD7', scale: 'frequency', prompt: 'Feeling afraid as if something awful might happen' },

  // --- CAGE-AID (alcohol and drug use) ---
  { id: 'cageaid_1', domain: 'CAGEAID', scale: 'yesno', prompt: 'Have you ever felt that you should cut down on your drinking or drug use?' },
  { id: 'cageaid_2', domain: 'CAGEAID', scale: 'yesno', prompt: 'Have people annoyed you by criticizing your drinking or drug use?' },
  { id: 'cageaid_3', domain: 'CAGEAID', scale: 'yesno', prompt: 'Have you ever felt bad or guilty about your drinking or drug use?' },
  { id: 'cageaid_4', domain: 'CAGEAID', scale: 'yesno', prompt: 'Have you ever used alcohol or drugs first thing in the morning to steady your nerves or get rid of a hangover?' },
]

export const TOTAL_QUESTION_COUNT = SCREENING_QUESTIONS.length // 20

const PHQ9_IDS = SCREENING_QUESTIONS.filter((q) => q.domain === 'PHQ9').map((q) => q.id)
const GAD7_IDS = SCREENING_QUESTIONS.filter((q) => q.domain === 'GAD7').map((q) => q.id)
const CAGEAID_IDS = SCREENING_QUESTIONS.filter((q) => q.domain === 'CAGEAID').map((q) => q.id)
const SAFETY_ITEM_ID = SCREENING_QUESTIONS.find((q) => q.isSafetyItem).id

const HIGH_CUTOFF = 15 // standard "severe" threshold for both PHQ-9 and GAD-7
const ELEVATED_CUTOFF = 10 // standard "moderate" threshold for both
const CAGE_POSITIVE_CUTOFF = 2 // standard clinical positive threshold

function sumFor(answers, ids) {
  return ids.reduce((sum, id) => sum + (answers[id] ?? 0), 0)
}

// answers: { [questionId]: numericValue }, exactly 20 entries expected.
// Returns the full scored result — callers store phq9Score/gad7Score/
// cageScore however they like, and riskLevel drives the referral flow
// exactly like the old custom check-in did.
export function scoreCheckIn(answers) {
  const phq9Score = sumFor(answers, PHQ9_IDS)
  const gad7Score = sumFor(answers, GAD7_IDS)
  const cageScore = sumFor(answers, CAGEAID_IDS)
  const selfHarmAnswer = answers[SAFETY_ITEM_ID] ?? 0

  const substanceFlag = cageScore >= CAGE_POSITIVE_CUTOFF

  let riskLevel
  if (selfHarmAnswer > 0) {
    riskLevel = 'ACUTE'
  } else if (phq9Score >= HIGH_CUTOFF || gad7Score >= HIGH_CUTOFF) {
    riskLevel = 'HIGH'
  } else if (phq9Score >= ELEVATED_CUTOFF || gad7Score >= ELEVATED_CUTOFF || substanceFlag) {
    riskLevel = 'ELEVATED'
  } else {
    riskLevel = 'LOW'
  }

  return {
    riskLevel,
    substanceFlag,
    phq9Score,
    gad7Score,
    cageScore,
    totalScore: phq9Score + gad7Score + cageScore,
    maxScore: 27 + 21 + 4, // PHQ-9 max 27, GAD-7 max 21, CAGE-AID max 4
  }
}

// Used by the check-in route to decide whether to create a SafetyAlert
// immediately, independent of the overall riskLevel tiering above.
export function isImmediateSafetyTrigger(answers) {
  return (answers[SAFETY_ITEM_ID] ?? 0) > 0
}