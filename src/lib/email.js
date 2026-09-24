import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM_ADDRESS = 'Mindora <onboarding@resend.dev>'

export async function sendOtpEmail(to, code) {
  await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: 'Your Mindora login code',
    html: `
      <div style="font-family: sans-serif; max-width: 480px;">
        <h2 style="color: #0f1e3d;">Your Mindora login code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0f1e3d;">${code}</p>
        <p style="color: #565d70;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}