/** "a, b\nc" → ["a", "b", "c"] (same rule as the backend's parse_term_list). */
export function parseTerms(text: string): string[] {
  return text
    .split(/[,\n;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function joinTerms(terms: string[]): string {
  return terms.join(", ");
}

/** Same lists, ignoring case, order and duplicates. */
export function sameTerms(a: string[], b: string[]) {
  const key = (terms: string[]) => [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort().join("\n");
  return key(a) === key(b);
}

/** Problems with a user-edited term list, or null if it is fine. */
export function checkTerms(terms: string[], maxTerms = 500, maxLength = 60): string | null {
  if (terms.length > maxTerms) return `At most ${maxTerms} entries (this list has ${terms.length}).`;
  const long = terms.find((t) => t.length > maxLength);
  if (long) return `Entries must be at most ${maxLength} characters ("${long.slice(0, 20)}…").`;
  return null;
}
