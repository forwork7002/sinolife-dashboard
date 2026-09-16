/**
 * What this integration actually costs Bitrix24, from our own `sync_log`.
 *
 *     npm run bitrix:cost
 *
 * WHY THIS EXISTS, AND WHY IT IS A SCRIPT RATHER THAN A PARAGRAPH
 * `obey.bitrix24.kz` blocked us portal-wide three days running — 2026-09-14
 * 11:20, 2026-09-15 10:50, 2026-09-16 11:53, all `OVERLOAD_LIMIT`, all late
 * morning. Every investigation before this one counted REQUESTS and RECORDS,
 * because those are the numbers our side of the wire can see, and by both
 * measures the integration looked modest. The block was diagnosed only when
 * somebody thought to ask a third question: how long does the PORTAL spend
 * answering us.
 *
 * `sync_log` has held the answer since the day it was written. `finishedAt -
 * startedAt` on a pass is almost entirely the portal's own execution time —
 * the database writes around it are microseconds by comparison — and it is
 * what `OVERLOAD_LIMIT` and `OPERATION_TIME_LIMIT` are measured against.
 * Nobody had ever summed it.
 *
 * WHAT IT FOUND, 2026-09-16, over three days:
 *
 *     DEALS            1 970 passes   avg 31.8 s   TOTAL 17.4 HOURS      32 782 records
 *     STAGE_HISTORY    1 971 passes   avg  1.1 s   total 38 minutes   1 465 859 records
 *
 * DEALS read FORTY-FIVE TIMES FEWER records and spent TWENTY-EIGHT TIMES more
 * of the portal's time — 1 200x more per record. The cost was not the data. It
 * was `batchWalk` sending a fixed chain of FIFTY `crm.deal.list` commands on
 * every tick, of which about 48 existed only to discover there was nothing more
 * to read, at ~0.64 s of portal execution each. Sustained, that was 81–114
 * seconds of portal time per TEN MINUTES, day and night, against the 480 s
 * Bitrix24 allows one method in that window — and three times that before the
 * tick was slowed from 60 s to 180 s. Add the client's own sales floor working
 * `crm.deal.*` through the morning and the method's basket empties, which is
 * why every block landed between 10:50 and 11:59.
 *
 * HOW TO READ IT
 * The column that matters is `sek/10daq` — seconds of portal execution per
 * ten-minute window, per method, against a budget of 480. Anything in double
 * digits deserves an explanation; anything in three is the next outage.
 * `sek/yozuv` is the tell that separates «we are reading a lot» from «we are
 * asking badly»: a high total with a low per-record cost is honest work, a high
 * per-record cost is waste.
 */
import 'dotenv/config'

import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { caCertFromEnv, poolConfig } from '../src/server/db/poolConfig'
import { PrismaClient } from '../src/generated/prisma/client'

/** Seconds of operating time Bitrix24 allows one method per ten minutes. */
const BUDGET_PER_10_MIN_S = 480

/** How much of that budget one method may take before this script complains. */
const WARN_FRACTION = 0.1

interface Row {
  entity: string
  passes: bigint
  avg_s: number
  max_s: number
  total_s: number
  records: bigint
}

async function main(): Promise<void> {
  const days = Number(process.argv[2] ?? 3)
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL yoʻq.')
    process.exitCode = 1
    return
  }

  const pool = new Pool(poolConfig(url, { caCert: caCertFromEnv() }))
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  try {
    /*
      FAILED PASSES ARE EXCLUDED ON PURPOSE.

      A refused call returns in milliseconds, so counting an outage's thousands
      of instant failures would drag every average towards zero and make the
      integration look cheapest exactly when it had just been blocked.
    */
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT entity::text AS entity,
             count(*) AS passes,
             avg(extract(epoch FROM ("finishedAt" - "startedAt")))::float8 AS avg_s,
             max(extract(epoch FROM ("finishedAt" - "startedAt")))::float8 AS max_s,
             sum(extract(epoch FROM ("finishedAt" - "startedAt")))::float8 AS total_s,
             sum("recordsRead") AS records
        FROM sync_log
       WHERE "startedAt" > now() - make_interval(days => ${days}::int)
         AND "finishedAt" IS NOT NULL
         AND status <> 'FAILED'
       GROUP BY 1
       ORDER BY 5 DESC`

    const windows = (days * 24 * 60) / 10

    console.log(`\n  Bitrix24 — bizning yukimiz, oxirgi ${days} kun`)
    console.log(`  ${'─'.repeat(86)}`)
    console.log(
      `  ${'metod'.padEnd(16)}${'passlar'.padStart(9)}${'o‘rt s'.padStart(9)}` +
        `${'jami daq'.padStart(11)}${'sek/10daq'.padStart(11)}${'yozuv'.padStart(11)}${'sek/yozuv'.padStart(11)}`,
    )

    let worst = 0
    for (const r of rows) {
      const per10 = r.total_s / windows
      const records = Number(r.records)
      const perRecord = records > 0 ? r.total_s / records : null
      worst = Math.max(worst, per10)

      const flag = per10 >= BUDGET_PER_10_MIN_S * WARN_FRACTION ? ' ←' : ''
      console.log(
        `  ${r.entity.padEnd(16)}${String(r.passes).padStart(9)}` +
          `${r.avg_s.toFixed(2).padStart(9)}${(r.total_s / 60).toFixed(1).padStart(11)}` +
          `${per10.toFixed(1).padStart(11)}${records.toLocaleString('ru').padStart(11)}` +
          `${(perRecord === null ? '—' : perRecord.toFixed(4)).padStart(11)}${flag}`,
      )
    }

    console.log(`  ${'─'.repeat(86)}`)
    console.log(
      `  Bitrix24 bitta metodga 10 daqiqada ${BUDGET_PER_10_MIN_S}s beradi.` +
        ` Eng band metodimiz: ${worst.toFixed(0)}s` +
        ` (${Math.round((worst / BUDGET_PER_10_MIN_S) * 100)}%).`,
    )
    /*
      THE TWO-SENTENCE READING, PRINTED RATHER THAN LEFT TO BE REMEMBERED. The
      figure that mattered on 2026-09-16 was not any single number but the
      RATIO between two rows, and a table alone did not make anybody look at it.
    */
    console.log(
      '  Yuqori «sek/yozuv» = kam maʼlumot uchun koʻp soʻrov — yaʼni yomon soʻrayapmiz,\n' +
        '  koʻp oʻqiyotganimiz uchun emas. Aynan shu 2026-09-14/15/16 bloklarini keltirgan.\n',
    )
  } finally {
    await prisma.$disconnect()
    await pool.end()
  }
}

void main()
