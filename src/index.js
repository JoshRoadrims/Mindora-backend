import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { attachAuth } from './middleware/auth.js'
import { authRouter } from './routes/auth.routes.js'
import { referralRouter } from './routes/referral.routes.js'
import { checkInRouter } from './routes/checkin.routes.js'
import { adminRouter } from './routes/admin.routes.js'
import { professionalRouter } from './routes/professional.routes.js'
import { appointmentRouter } from './routes/appointment.routes.js'

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(attachAuth)

app.get('/health', (_req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }))

app.use('/api/auth', authRouter)
app.use('/api/referrals', referralRouter)
app.use('/api/check-ins', checkInRouter)
app.use('/api/admin', adminRouter)
app.use('/api/professionals', professionalRouter)
app.use('/api/appointments', appointmentRouter)

// Centralised error handler — keeps stack traces out of prod responses.
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : err.message,
  })
})

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`Mindora API listening on http://localhost:${port} [${process.env.NODE_ENV}]`)
})