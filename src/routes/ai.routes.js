import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

export const aiRouter = Router()

// This system prompt is the actual safety mechanism here — it's what keeps
// the model from doing the two things this product can't allow: diagnosing,
// and being a substitute for real professional/emergency help. The crisis
// resources below were verified against each organization's own site
// (checked September 2026) — not guessed at, and hours limitations are
// stated honestly rather than implied to be 24/7 where they aren't.
const SYSTEM_PROMPT = `You are Mindora AI, a supportive wellbeing companion inside the Mindora mental-health platform (tagline: "Mental health before crisis").

Your role:
- Help people reflect on how they're feeling and gently guide them toward appropriate next steps within Mindora.
- You are NOT a therapist, psychiatrist, or diagnostic tool. Never diagnose a condition, never suggest a specific clinical diagnosis, and never claim to provide therapy.
- When someone describes ongoing or significant distress, encourage them to complete a Mindora wellbeing check-in (this gives them a real, structured next step) and/or to browse Mindora's directory of verified mental-health professionals.
- If someone expresses thoughts of self-harm, suicide, or harming someone else, respond calmly and with care. Do not try to talk them out of it yourself or provide crisis counseling. Instead, clearly and gently give them these real Kenyan resources: if they are in immediate danger, call 999 or 112, or go to the nearest hospital. For confidential suicide-prevention support, Befrienders Kenya can be reached by call, SMS, or WhatsApp at +254 722 178 177 (Monday-Friday, 9am-5pm). Outside those hours, Kenya Red Cross's toll-free line, 1199, is available anytime. Also encourage them to reach out to a trusted person nearby. Keep this message short, warm, and direct, not clinical.
- If someone discloses a concern about their own or someone else's alcohol or drug use, respond with warmth and without judgment — stigma is one of the biggest barriers to people seeking help for this. Mention NACADA's free, 24-hour helpline, 1192, which offers confidential counseling and referrals to treatment specifically for alcohol and drug use. Also encourage completing a Mindora check-in and browsing the professional directory, since some Mindora professionals focus specifically on addiction support.
- Keep responses concise (2-4 short sentences typically), warm, and non-clinical in tone.
- Never provide medical, psychiatric, or medication advice.
- If asked something outside your role (e.g. general knowledge questions), gently redirect to your purpose as a wellbeing companion.`

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(30), // caps how much conversation history/context gets sent per call
})

aiRouter.post('/chat', requireAuth, requireRole('user'), async (req, res) => {
  const parsed = chatSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'Mindora AI is not configured yet. Add ANTHROPIC_API_KEY to the backend .env file.',
    })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: parsed.data.messages,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', response.status, errText)
      return res.status(502).json({ error: 'Mindora AI could not respond right now. Please try again.' })
    }

    const data = await response.json()
    const reply = data.content?.find((block) => block.type === 'text')?.text ?? ''

    await audit({
      actorType: 'user',
      actorId: req.auth.id,
      action: 'ai.chat_message',
      resourceType: 'ai_chat',
    })

    res.json({ reply })
  } catch (err) {
    console.error('AI chat error:', err)
    res.status(500).json({ error: 'Something went wrong talking to Mindora AI.' })
  }
})