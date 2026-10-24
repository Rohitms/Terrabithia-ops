// parseLead.ts — turns the messy "first name / last name" lead fields into structured data.
// Works on the concatenated string, so it doesn't matter where the name ends and the details begin.

export type DatePrecision = "day" | "week" | "month";

export interface ParsedLead {
  name: string;
  eventType: string | null;
  eventDate: string | null; // ISO yyyy-mm-dd (start of week/month when approximate)
  datePrecision: DatePrecision | null;
  guestMin: number | null;
  guestMax: number | null;
  needsReview: boolean;
  reviewReasons: string[];
  rawFirst: string;
  rawLast: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD_RE = "(1st|first|2nd|second|3rd|third|4th|fourth|last)";
const WEEK_START: Record<string, number> = {
  "1st": 1, first: 1, "2nd": 8, second: 8, "3rd": 15, third: 15, "4th": 22, fourth: 22, last: 22,
};

// Longest/most specific first so "bride to be" wins over "bride".
const EVENT_TYPES: [RegExp, string][] = [
  [/\bbride[\s-]*to[\s-]*be\b/i, "Bride to be"],
  [/\bbridal\s+shower\b/i, "Bridal shower"],
  [/\bbaby\s+shower\b/i, "Baby shower"],
  [/\bpre[\s-]*wedding\b/i, "Pre-wedding"],
  [/\bsave\s+the\s+date\b/i, "Save the date"],
  [/\bfarm\s*stay\b/i, "Farm stay"],
  [/\bwedding\b/i, "Wedding"],
  [/\bengagement\b/i, "Engagement"],
  [/\breception\b/i, "Reception"],
  [/\bhaldi\b/i, "Haldi"],
  [/\bmehend[iy]\b/i, "Mehendi"],
  [/\bbirthday\b|\bb'?day\b/i, "Birthday"],
  [/\banniversary\b/i, "Anniversary"],
  [/\bphoto\s*shoot\b/i, "Photoshoot"],
];

function monthNum(s: string): number {
  return MONTHS[s.slice(0, 3).toLowerCase()];
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// No year given → next occurrence on/after today.
function inferYear(m: number, d: number, now: Date): number {
  const y = now.getUTCFullYear();
  const today = Date.UTC(y, now.getUTCMonth(), now.getUTCDate());
  return Date.UTC(y, m - 1, d) >= today ? y : y + 1;
}

function resolve(m: number, d: number, yearStr: string | undefined, now: Date): string | null {
  const y = yearStr ? Number(yearStr) : inferYear(m, d, now);
  return isoDate(y, m, d);
}

export function parseLead(first: string, last: string, now: Date = new Date()): ParsedLead {
  const rawFirst = first ?? "";
  const rawLast = last ?? "";
  let text = `${rawFirst} ${rawLast}`.replace(/\s+/g, " ").trim();
  const reasons: string[] = [];

  // 1. Guests: "100pax", "150-200 pax", "~120 guests"
  let guestMin: number | null = null;
  let guestMax: number | null = null;
  const paxRange = text.match(/~?\s*(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})\s*(?:pax|guests?|people|persons?|ppl)\b/i);
  const paxOne = text.match(/~?\s*(\d{1,4})\s*\+?\s*(?:pax|guests?|people|persons?|ppl)\b/i);
  if (paxRange) {
    guestMin = Math.min(+paxRange[1], +paxRange[2]);
    guestMax = Math.max(+paxRange[1], +paxRange[2]);
    text = text.replace(paxRange[0], " ");
  } else if (paxOne) {
    guestMin = guestMax = +paxOne[1];
    text = text.replace(paxOne[0], " ");
  }

  // 2. Date (most specific pattern first)
  let eventDate: string | null = null;
  let datePrecision: DatePrecision | null = null;
  let m: RegExpMatchArray | null;

  if ((m = text.match(new RegExp(`\\b${ORD_RE}\\s+week\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "i")))) {
    eventDate = resolve(monthNum(m[2]), WEEK_START[m[1].toLowerCase()], m[3], now);
    datePrecision = "week";
  } else if ((m = text.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+${ORD_RE}\\s+week\\b(?:,?\\s+(\\d{4}))?`, "i")))) {
    eventDate = resolve(monthNum(m[1]), WEEK_START[m[2].toLowerCase()], m[3], now);
    datePrecision = "week";
  } else if ((m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "i")))) {
    eventDate = resolve(monthNum(m[2]), +m[1], m[3], now);
    datePrecision = "day";
  } else if ((m = text.match(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "i")))) {
    eventDate = resolve(monthNum(m[1]), +m[2], m[3], now);
    datePrecision = "day";
  } else if ((m = text.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/))) {
    // Indian convention: dd/mm(/yyyy)
    const yr = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : undefined;
    eventDate = resolve(+m[2], +m[1], yr, now);
    datePrecision = "day";
  } else if ((m = text.match(new RegExp(`\\b${MONTH_RE}\\b(?:,?\\s+(\\d{4}))?`, "i")))) {
    eventDate = resolve(monthNum(m[1]), 1, m[2], now);
    datePrecision = "month";
  }
  if (m && eventDate) text = text.replace(m[0], " ");
  else if (m && !eventDate) reasons.push("date looked invalid");

  // 3. Event type
  let eventType: string | null = null;
  for (const [re, label] of EVENT_TYPES) {
    if (re.test(text)) {
      eventType = label;
      text = text.replace(re, " ");
      break;
    }
  }

  // 4. What's left is the name
  const name = text.replace(/[,\-–:|]+/g, " ").replace(/\s+/g, " ").trim();

  if (!name) reasons.push("no name found");
  if (!eventDate) reasons.push("no event date");
  if (guestMin === null) reasons.push("no guest count");
  if (datePrecision && datePrecision !== "day") reasons.push(`date only approximate (${datePrecision})`);

  return {
    name, eventType, eventDate, datePrecision, guestMin, guestMax,
    needsReview: reasons.length > 0, reviewReasons: reasons, rawFirst, rawLast,
  };
}
