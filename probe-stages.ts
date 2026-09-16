/* Local reference database only (sinolife_b24 holds the real Bitrix24
   pipelines and stages, pulled with bitrix:resync). No production access. */
import { Client } from 'pg'

async function main() {
  const c = new Client({ connectionString: 'postgresql://smack@127.0.0.1:5433/sinolife_b24' })
  await c.connect()
  const r = await c.query(`
    SELECT s."externalId" AS id, s."name", s."category", s."sortOrder" AS ord
    FROM "deal_stage" s JOIN "pipeline" p ON p."id" = s."pipelineId"
    WHERE p."role" = 'RETENTION'
    ORDER BY s."sortOrder"
  `)
  console.table(r.rows)
  await c.end()
}
void main()
