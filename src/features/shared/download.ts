'use client'

/**
 * A CSV already written out — its BOM and separators the caller's — into the
 * browser's downloads: a Blob behind a throwaway link, clicked once and let go.
 */
export function downloadCsvText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
