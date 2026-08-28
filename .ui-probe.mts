import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from './src/generated/prisma/client'
import { caCertFromEnv, poolConfig } from './src/server/db/poolConfig'

const url = process.env.DATABASE_URL!
const pool = new Pool(poolConfig(url, { caCert: caCertFromEnv() }))
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const snap = await prisma.marketingSnapshot.findUnique({ where: { id: 'roistat' } })
console.log('snapshot:', snap)
const counts = await prisma.$queryRawUnsafe(`SELECT "dimension"::text AS d, count(*)::int AS n, count(distinct key)::int AS keys, min("date")::text AS f, max("date")::text AS t FROM "marketing_daily" GROUP BY 1 ORDER BY 1`)
console.log(counts)
const totals = await prisma.$queryRawUnsafe(`SELECT sum(leads)::int leads, sum(clean)::int clean, sum(kval)::int kval, sum(orders)::int orders, sum(sold)::int sold, sum("newCustomers")::int newc, sum("spendMicroUsd")::text spend, sum("orderedMinor")::text f1, sum("soldMinor")::text f2, sum("metaRevenueMinor")::text mrev, sum(impressions)::text impr, sum(reach)::text reach, sum(clicks)::text clicks, sum("metaLeads")::int mleads FROM "marketing_daily" WHERE dimension='DAYS'`)
console.log(totals)
await prisma.$disconnect(); await pool.end()
