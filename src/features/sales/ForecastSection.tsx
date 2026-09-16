"use client";

import { ErrorState } from "@/components/states/States";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { RankBadge, StatTile } from "@/components/ui/Stat";
import { useFaktBoard } from "@/features/sales/ConfirmationFaktSection";
import { QUEUE_BASIS } from "@/features/shared/faktVocabulary";
import type { SellerBoardDto, SellerBoardRowDto } from "@/lib/api";
import {
  NO_VALUE,
  formatDateShort,
  formatFullUzs,
  formatPercent,
} from "@/lib/format";

/**
 * PROGNOZ — where this period lands if the floor keeps the pace it has set.
 *
 * Asked for on 2026-09-16, for FAKT 1 and FAKT 2 together and at every level
 * the board already reports: the company, each ROP team and each seller. Three
 * of those four were already computable and none of them was computed — the
 * payload carried ONE projection, of FAKT 2, for the company, and a single
 * tile on the queue band was the only thing that read it.
 *
 * IT COSTS NO REQUEST AND NO QUERY. A straight-line run-rate is
 * `money ÷ elapsed fraction`, and the elapsed fraction is one number for the
 * whole screen — so every figure here is arithmetic over rows that were
 * already on `/analytics/sellers`. `useFaktBoard` is the same query the hero
 * and the FAKT band read, served from one TanStack cache entry, which is also
 * what makes it impossible for this block to disagree with the figures above
 * it.
 *
 * THE HORIZON IS THE SELECTED PERIOD'S OWN CALENDAR UNIT, NOT THE WINDOW.
 * «Shu oy» resolves to [1-sen, ertaga) — a to-date window is by construction
 * almost entirely elapsed, and dividing by that fraction projects a month
 * forward by a few percent and calls the result «oy yakuni». `fullUnitWindow`
 * is the fix and it predates this block; `performance.ts` records the same bug
 * from the KPI screen, where the number was wrong every day of every month.
 * A finished preset passes through with an elapsed fraction of 1, and then
 * there is no projection to make — which this block SAYS rather than printing
 * a total under a forecast heading.
 *
 * NOTHING HERE IS A MEASUREMENT AND THE PAGE MUST NOT READ AS IF IT WERE.
 * Every projected figure is printed beside what has actually landed, the
 * heading says «shu surʼatda davom etsa», and the reader is told how much of
 * the period the claim rests on. A run-rate knows nothing about weekends, a
 * public holiday or a portal outage; it is a pace restated, and it is useful
 * exactly as long as the reader knows that.
 */
export function ForecastSection() {
  const { query, data, status } = useFaktBoard();

  return (
    <section
      aria-labelledby="prognoz-heading"
      className="space-y-3"
      style={{
        opacity: query.isPlaceholderData ? 0.6 : 1,
        transition: "opacity 150ms var(--ease-out)",
      }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="prognoz-heading" className="eyebrow">
          Prognoz · davr yakuni
        </h2>
        <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          {QUEUE_BASIS} · butun kompaniya boʻyicha · toʻgʻri chiziqli surʼat
        </p>
      </div>

      {status === "error" ? (
        <ErrorState
          message={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ForecastBand data={data} status={status} />
      )}
    </section>
  );
}

/**
 * The block itself, given an answer rather than fetching one.
 *
 * Split out for the same reason `QueueBand` is: the wiring above is one
 * `useQuery` and nothing worth asserting, while everything below turns on
 * which of three absences the payload is reporting — and a test that has to
 * stand up a QueryClient to reach that is a test of TanStack.
 *
 * Exported for `tests/features/salesForecast.test.tsx`.
 */
export function ForecastBand({
  data,
  status,
}: {
  data: SellerBoardDto | undefined;
  status: "loading" | "error" | "ready";
}) {
  const forecast = data?.forecast;
  const totals = data?.totals;

  /*
    ONE QUESTION ANSWERS THE WHOLE BLOCK: is there a projection at all?

    `fakt1` and `fakt2` are null together — they are divided by the same
    elapsed fraction — so the absence is a property of the PERIOD rather than
    of either fact, and it is stated once at the top instead of as eight em
    dashes the reader has to interpret. Three different absences reach here and
    the sentence names each: the period is over, too little of it has elapsed
    to divide by, or the board is still loading.
  */
  const projecting = forecast?.fakt1 != null || forecast?.fakt2 != null;

  /*
    The last instant INSIDE the window, which is the date a reader recognises.

    `windowEnd` is half-open like every other bound in this product — the first
    instant NOT projected — so printing it raw names 1-okt as the end of
    September. One millisecond back is the whole correction, and it is done
    here rather than on the server because the server's value is the bound its
    arithmetic actually used and should stay that.
  */
  const horizon =
    forecast === undefined
      ? null
      : formatDateShort(
          new Date(Date.parse(forecast.windowEnd) - 1).toISOString(),
        );

  return (
    <div className="space-y-3">
      {/*
            THE SENTENCE BEFORE THE FIGURES, because it is the one thing that
            makes them readable. A figure under a heading that says «prognoz»
            has no method and no horizon attached; a reader who cannot see
            which month it runs to, or how much of that month the claim rests
            on, has no way to weigh it.
          */}
      <p className="text-xs" style={{ color: "var(--ink-secondary)" }}>
        {status === "loading" || forecast === undefined ? (
          "Yuklanmoqda…"
        ) : projecting ? (
          <>
            Davrning{" "}
            <strong>{formatPercent(forecast.elapsedPercent, 0)}</strong> qismi
            oʻtdi
            {horizon !== null && <> — prognoz {horizon} gacha</>}. Shu surʼatda
            davom etsa:
          </>
        ) : forecast.elapsedPercent >= 100 ? (
          "Davr yakunlangan — bu allaqachon natija, prognoz emas."
        ) : (
          "Davrning juda oz qismi oʻtdi — prognoz uchun erta."
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="FAKT 1 · davr yakuni prognozi"
          value={forecast?.fakt1?.amount ?? null}
          unit="money"
          money="full"
          status={status}
          accent="var(--series-2)"
          hint={
            projecting && totals
              ? `hozir ${formatFullUzs(totals.ordered.amount)}`
              : undefined
          }
        />
        <StatTile
          label="FAKT 2 · davr yakuni prognozi"
          value={forecast?.fakt2?.amount ?? null}
          unit="money"
          money="full"
          status={status}
          accent="var(--series-3)"
          hint={
            projecting && totals
              ? `hozir ${formatFullUzs(totals.won.amount)}`
              : undefined
          }
        />
        {/*
              WHAT IS STILL TO COME, which is the half of a forecast a floor
              can act on. «The month ends at 3.1 mlrd» is a verdict; «1.4 mlrd
              still to find» is a target somebody can be given this morning.

              A DIFFERENCE OF TWO FIGURES ALREADY ON SCREEN, and deliberately
              so — it is not a third measurement and must not look like one,
              which is why these two carry the compact format the pair above
              them does not.
            */}
        <StatTile
          label="FAKT 1 · kutilayotgan qoldiq"
          value={
            forecast?.fakt1 && totals
              ? forecast.fakt1.amount - totals.ordered.amount
              : null
          }
          unit="money"
          status={status}
          hint={projecting ? "prognoz minus hozirgi" : undefined}
        />
        <StatTile
          label="FAKT 2 · kutilayotgan qoldiq"
          value={
            forecast?.fakt2 && totals
              ? forecast.fakt2.amount - totals.won.amount
              : null
          }
          unit="money"
          status={status}
          hint={projecting ? "prognoz minus hozirgi" : undefined}
        />
      </div>

      <SellersForecastTable
        rows={data?.rows ?? []}
        status={status}
        projecting={projecting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Every seller, what they have, and where they land.
 *
 * SAVDO DINAMIKASI HAS NEVER CARRIED A SELLER LIST — the board lives on
 * Sotuvchilar reytingi, which is a television and shows rank and money rather
 * than a projection. This table exists because the question the client asked
 * («sotuvchi barchasini prognozini koʻra olishimiz kerak») is a per-person one
 * and no screen answered it.
 *
 * THE ORDER IS THE BOARD'S OWN, NOT THE PROJECTION'S. `rows` arrives ranked by
 * FAKT 2 then FAKT 1, with competition ranking, and re-sorting it by the
 * forecast would seat one champion here and another on `/sellers` — for one
 * month, in one company. The projection is a COLUMN here, never the key.
 *
 * Every row is on the payload already; there is no pagination and no second
 * request.
 */
function SellersForecastTable({
  rows,
  status,
  projecting,
}: {
  rows: readonly SellerBoardRowDto[];
  status: "loading" | "error" | "ready";
  /** False when the period cannot be projected at all — see `ForecastSection`. */
  projecting: boolean;
}) {
  const columns: readonly Column<SellerBoardRowDto>[] = [
    {
      key: "rank",
      header: "Oʻrin",
      width: "64px",
      render: (row) => <RankBadge rank={row.rank} />,
    },
    {
      key: "seller",
      header: "Sotuvchi",
      rowHeader: true,
      render: (row) => row.fullName,
    },
    {
      key: "rop",
      header: "ROP",
      /* Null is a real state here — a seller filed under no ROP is on this
         table and on no team row, which is the reconciliation the teams table
         prints in words underneath itself. */
      render: (row) => row.rop ?? NO_VALUE,
    },
    {
      key: "fakt1",
      header: "FAKT 1",
      align: "right",
      numeric: true,
      render: (row) => formatFullUzs(row.ordered.amount),
    },
    {
      key: "fakt1Forecast",
      header: "FAKT 1 prognoz",
      align: "right",
      numeric: true,
      /* Em dash, never a zero. A seller with nothing yet has no projection,
         which is not the same claim as "this seller ends the period at
         nothing" — and on this cohort the second is wrong every morning,
         because delivery lags the arrival it is projected from. */
      render: (row) =>
        row.forecast.fakt1 === null
          ? NO_VALUE
          : formatFullUzs(row.forecast.fakt1.amount),
    },
    {
      key: "fakt2",
      header: "FAKT 2",
      align: "right",
      numeric: true,
      render: (row) => formatFullUzs(row.won.amount),
    },
    {
      key: "fakt2Forecast",
      header: "FAKT 2 prognoz",
      align: "right",
      numeric: true,
      render: (row) =>
        row.forecast.fakt2 === null
          ? NO_VALUE
          : formatFullUzs(row.forecast.fakt2.amount),
    },
  ];

  return (
    <div className="space-y-2">
      <h3
        className="text-sm font-semibold tracking-tight"
        style={{ color: "var(--ink-primary)" }}
      >
        Sotuvchilar boʻyicha · hozirgi va prognoz
      </h3>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.employeeId}
        status={status}
        emptyTitle="Bu davrda sotuvchi boʻyicha maʼlumot yoʻq"
        /* Four full-digit money columns; below this the table scrolls sideways
           inside its own box rather than crushing the digits. */
        minWidth={980}
      />
      {!projecting && status === "ready" && (
        <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          Prognoz ustunlari boʻsh — sababi yuqorida yozilgan.
        </p>
      )}
    </div>
  );
}
