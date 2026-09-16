import { Medal } from '@/features/sellers/Medal'
import { MEDALS } from '@/features/sellers/medalCatalog'
import { medalReason } from '@/features/sellers/medalReason'
import type { SellerMedalDto } from '@/lib/api'

/** Gapiruvchi karta — ustunning soati navbat bergan medal, nomi va sababi bilan. */
export function SpeakingMedal({ medal }: { medal: SellerMedalDto }) {
  return (
    <div className="medal-speak">
      <Medal code={medal.code} size="speaking" count={medal.count} label={false} />
      <div>
        <p className="medal-speak-name">{MEDALS[medal.code].name}</p>
        <p className="medal-speak-why">{medalReason(medal)}</p>
      </div>
    </div>
  )
}
