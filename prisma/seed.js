import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('demo-password', 12)

  const user = await prisma.user.upsert({
    where: { email: 'joshua@example.com' },
    update: {},
    create: { fullName: 'Joshua Otieno', email: 'joshua@example.com', passwordHash },
  })

  const professional = await prisma.professional.upsert({
    where: { email: 'sarah.mwangi@example.com' },
    update: { verified: true },
    create: {
      fullName: 'Dr. Sarah Mwangi',
      email: 'sarah.mwangi@example.com',
      passwordHash,
      type: 'CLINICAL_PSYCHOLOGIST',
      bio: 'Clinical psychologist with 9 years of experience supporting young adults through anxiety, depression, and major life transitions.',
      qualifications: ['PhD, Clinical Psychology — University of Nairobi'],
      focusAreas: ['Anxiety', 'Depression', 'Young Adults'],
      languages: ['English', 'Swahili'],
      yearsExperience: 9,
      location: 'Nairobi, Kenya',
      feeKes: 3000,
      onlineAvailable: true,
      inPersonAvailable: true,
      verified: true,
    },
  })

  const platformAdmin = await prisma.admin.upsert({
    where: { email: 'admin@mindora.local' },
    update: { role: 'PLATFORM_ADMIN' },
    create: {
      fullName: 'Mindora Platform Team',
      email: 'admin@mindora.local',
      passwordHash,
      role: 'PLATFORM_ADMIN',
    },
  })

  const safetyReviewer = await prisma.admin.upsert({
    where: { email: 'safety@mindora.local' },
    update: { role: 'CLINICAL_SAFETY_REVIEWER' },
    create: {
      fullName: 'Mindora Clinical Safety',
      email: 'safety@mindora.local',
      passwordHash,
      role: 'CLINICAL_SAFETY_REVIEWER',
    },
  })

  const support = await prisma.admin.upsert({
    where: { email: 'support@mindora.local' },
    update: { role: 'SUPPORT' },
    create: {
      fullName: 'Mindora Support',
      email: 'support@mindora.local',
      passwordHash,
      role: 'SUPPORT',
    },
  })

  const checkIn = await prisma.checkIn.create({
    data: {
      userId: user.id,
      riskLevel: 'ELEVATED',
      totalScore: 16,
      maxScore: 30,
      answers: {
        create: [
          { domain: 'mood', questionId: 'mood', value: 2 },
          { domain: 'anxiety', questionId: 'anxiety', value: 2 },
          { domain: 'sleep', questionId: 'sleep', value: 3 },
          { domain: 'energy', questionId: 'energy', value: 2 },
        ],
      },
    },
  })

  await prisma.referral.create({
    data: {
      userId: user.id,
      checkInId: checkIn.id,
      professionalId: professional.id,
      status: 'PENDING',
      reason: 'Screening responses indicate that professional assessment may be beneficial.',
      flags: {
        create: [
          { label: 'Self-reported sleep disruption for 2+ weeks' },
          { label: 'Elevated stress score for 2 consecutive check-ins' },
        ],
      },
    },
  })

  console.log('Seed complete:', {
    user: user.email,
    professional: professional.email,
    platformAdmin: platformAdmin.email,
    safetyReviewer: safetyReviewer.email,
    support: support.email,
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())