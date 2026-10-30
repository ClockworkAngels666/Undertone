/** Who spoke for a corpus code in a given year, where that differs from today's state. The corpus files the Soviet
 *  Union's statements (1946–1991) under RUS and the Republic of China's (1946–1971, until General Assembly
 *  resolution 2758 gave the seat to the People's Republic) under CHN. */
const SEAT_HOLDERS: Record<string, { until: number; name: string; flag: string }> = {
  RUS: { until: 1991, name: "Soviet Union", flag: "USSR" },     // no flag file: a plain flag with "USSR" on it
  CHN: { until: 1971, name: "Republic of China", flag: "TWN" },
};

function holder(code: string, year: number | null | undefined) {
  const h = SEAT_HOLDERS[code];
  return h && year !== null && year !== undefined && year <= h.until ? h : null;
}

/** The delegation's name in that year: "Soviet Union" for RUS in 1960, otherwise `name`. */
export function speakerName(code: string, year: number | null | undefined, name: string) {
  return holder(code, year)?.name ?? name;
}

/** The code whose flag to show in that year: "USSR" for RUS in 1960, "TWN" for CHN in 1960, otherwise `code`. */
export function speakerFlag(code: string, year: number | null | undefined) {
  return holder(code, year)?.flag ?? code;
}
