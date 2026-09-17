export const FLIGHTS_URL = "https://www.google.com/travel/flights?hl=en";
export const FLIGHTS_GOAL =
  "Find one-way flights from Zurich to London on September 20, 2026, for one adult in economy. " +
  "Stop when matching flight options are visible. Do not select or book a flight.";

export interface FlightVerification {
  passed: boolean;
  checks: Record<string, boolean>;
  visible_flights: string[];
}

function dateInUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const encoded = parsed.searchParams.get("tfs") ?? "";
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url");
    return decoded.includes(Buffer.from("2026-09-20"));
  } catch {
    return false;
  }
}

export function verifyFlights(page: {
  url: string;
  text: string;
  actions: Array<{ label: string; value?: string }>;
}): FlightVerification {
  const parsed = new URL(page.url);
  const values = Object.fromEntries(page.actions.map((action) => [action.label.trim(), action.value]));
  const flights = page.actions.map((action) => action.label).filter((label) => label.includes("Select flight"));
  const checks = {
    search_page: parsed.hostname === "www.google.com" && parsed.pathname === "/travel/flights/search",
    one_way: values["Change ticket type. One way"] === "One way",
    origin: values["Where from?"] === "Zürich",
    destination: values["Where to?"] === "London",
    date: values["Departure"] === "Sun, Sep 20",
    year: dateInUrl(page.url) || page.text.includes("departing 2026-09-20"),
    results: flights.length > 0 && flights.every((label) => label.includes("Sunday, September 20")),
  };
  return { passed: Object.values(checks).every(Boolean), checks, visible_flights: flights };
}
