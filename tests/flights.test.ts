import { expect, test } from "vitest";

import { verifyFlights } from "../src/verify/flights.js";

test.each(["Departure", "Where from?", "Where to?", "year"] as const)(
  "flight verification rejects a wrong trip (%s)",
  (changed) => {
    const actual = {
      url: "https://www.google.com/travel/flights/search?tfs=example",
      text: "Track prices from Zürich to London departing 2026-09-20",
      actions: [
        { label: "Change ticket type. One way", value: "One way" },
        { label: "Where from?", value: "Zürich" },
        { label: "Where to?", value: "London" },
        { label: "Departure", value: "Sun, Sep 20" },
        { label: "Nonstop flight on Sunday, September 20. Select flight", value: "" },
      ],
    };
    expect(verifyFlights(actual).passed).toBe(true);
    if (changed === "year") {
      actual.text = actual.text.replace("2026", "2027");
    } else {
      const field = actual.actions.find((action) => action.label === changed);
      if (field) {
        field.value = "wrong";
      }
    }
    expect(verifyFlights(actual).passed).toBe(false);
  },
);
