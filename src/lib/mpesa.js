// Thin client for Safaricom's Daraja API (M-Pesa STK Push / Lipa Na M-Pesa
// Online). Sandbox and production use the same endpoints, just different
// base URLs and credentials — swap MPESA_ENV to 'production' and the real
// values once a real Paybill/Till exists.
//
// Nothing here trusts the frontend with money state. The frontend can ask
// us to *initiate* a push; only Safaricom's callback (handled in
// payment.routes.js) is allowed to mark a payment as PAID.

const ENV = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'

const BASE_URL =
  ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

// Access tokens are short-lived (~1 hour per Safaricom's docs). Cached in
// memory and refreshed a little early, which is fine for a single backend
// instance — if this ever runs on multiple instances, move this to Redis
// or similar so they don't each hammer the token endpoint.
let cachedToken = null
let cachedTokenExpiresAt = 0

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken

  const consumerKey = requireEnv('MPESA_CONSUMER_KEY')
  const consumerSecret = requireEnv('MPESA_CONSUMER_SECRET')
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')

  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })

  if (!res.ok) {
    throw new Error(`M-Pesa auth failed (${res.status}): ${await res.text()}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  // expires_in is in seconds; refresh 2 minutes early to be safe.
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) - 120) * 1000
  return cachedToken
}

function timestampNow() {
  // Daraja wants YYYYMMDDHHmmss, in the Africa/Nairobi-equivalent of
  // "local" time Safaricom expects — in practice, server local time is
  // fine for sandbox; for production this should run on a server whose
  // clock is correct (Render's is).
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

// Kenyan numbers only, normalised to Safaricom's expected 2547XXXXXXXX /
// 2541XXXXXXXX format (no +, no leading 0). Accepts common input shapes:
// 07XXXXXXXX, 7XXXXXXXX, 2547XXXXXXXX, +2547XXXXXXXX.
export function normalizeKenyanPhone(input) {
  const digits = String(input).replace(/\D/g, '')
  if (digits.startsWith('254') && digits.length === 12) return digits
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) return `254${digits}`
  return null // caller treats null as "invalid phone number"
}

// Initiates an STK Push: Safaricom sends a payment prompt to the given
// phone, and the result arrives later via callback, not in this response.
// This response only confirms the push was *sent*, not that it succeeded.
export async function initiateStkPush({ phoneNumber, amountKes, accountReference, description, callbackUrl }) {
  const shortcode = requireEnv('MPESA_SHORTCODE')
  const passkey = requireEnv('MPESA_PASSKEY')
  const timestamp = timestampNow()
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')

  const token = await getAccessToken()

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amountKes),
      PartyA: phoneNumber,
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: accountReference.slice(0, 12), // Daraja caps this field
      TransactionDesc: description.slice(0, 13), // and this one
    }),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok || data?.ResponseCode !== '0') {
    const message = data?.errorMessage || data?.ResponseDescription || `STK push failed (${res.status})`
    throw new Error(message)
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
  }
}