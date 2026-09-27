/**
 * Rank of a widget for a search term in the widget library, best first: 0 = the title starts
 * with it, 1 = another word of the title does, 2 = the title contains it, 3 = only the
 * description does, null = no match. Title matches come first (GUI audit 2026-09-26: "Uhr"
 * listed Festival-Uhr before Uhr, "Klick" listed Tempo-Korrektur first, because the list kept
 * registry order and matched descriptions).
 */
export function searchRank(definition: { title: string; description: string }, term: string): number | null {
  const title = definition.title.toLowerCase()
  if (title.startsWith(term)) return 0
  if (title.split(/[\s&-]+/).some((word) => word.startsWith(term))) return 1
  if (title.includes(term)) return 2
  if (definition.description.toLowerCase().includes(term)) return 3
  return null
}
