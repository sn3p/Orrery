import test from "node:test";
import assert from "node:assert/strict";
import { formatIsoDay, parseIsoDay, toJED } from "../src/js/utils.js";
import { parseShareDate, replaceShareUrl, shareDateValue, shareSearch } from "../src/unified/shareUrl.js";

const start = toJED(new Date(Date.UTC(1980, 0, 1)));
const jumped = toJED(new Date(Date.UTC(2005, 4, 3)));

test("parseIsoDay accepts canonical UTC calendar days and rejects invalid values", () => {
  assert.equal(parseIsoDay("2000-01-01")?.toISOString(), "2000-01-01T00:00:00.000Z");
  assert.equal(parseIsoDay("1980-01-01")?.toISOString(), "1980-01-01T00:00:00.000Z");
  for (const value of [null, undefined, "", "2000-1-1", "2000-13-01", "2000-02-30", "2000-01-01T00:00:00Z",
    "+002000-01-01"]) {
    assert.equal(parseIsoDay(value), null, String(value));
  }
});

test("parseShareDate returns a valid JED or ignores the query value", () => {
  assert.equal(parseShareDate("2005-05-03"), jumped);
  assert.equal(parseShareDate("1980-01-01"), start);
  for (const value of [null, "nope", "2005-05-32"]) assert.equal(parseShareDate(value), null);
});

test("shareSearch names Pixi and non-beginning dates, and preserves extra params", () => {
  const pixi = new URLSearchParams(shareSearch({ renderer: "pixi", date: "2005-05-03" }, "?extra=a%20b").slice(1));
  assert.equal(pixi.get("renderer"), "pixi");
  assert.equal(pixi.get("date"), "2005-05-03");
  assert.equal(pixi.get("extra"), "a b");

  const three = new URLSearchParams(shareSearch({ renderer: "three", date: "2000-01-01" }, "?renderer=pixi").slice(1));
  assert.equal(three.get("renderer"), null);
  assert.equal(three.get("date"), "2000-01-01");

  assert.equal(shareSearch({ renderer: "three", date: null }, "?renderer=pixi&date=2000-01-01"), "");
  assert.equal(shareSearch({ renderer: "pixi" }, "?date=2005-05-03"), "?date=2005-05-03&renderer=pixi");
  assert.equal(shareSearch({ renderer: "three", defaultRenderer: "pixi" }, "?date=2005-05-03"), "?date=2005-05-03&renderer=three",
    "The Pixi test oracle still names Three when Pixi is its omitted default");
  assert.equal(shareSearch({ renderer: "pixi", defaultRenderer: "pixi", date: null }, "?renderer=three"), "");
  assert.equal(shareSearch({ renderer: "unknown" }, "?extra=keep"), "?extra=keep&renderer=unknown",
    "Unrecognized renderer ids stay shareable so reload still shows the fallback notice");
  assert.equal(shareDateValue(start, start), null);
  assert.equal(shareDateValue(jumped, start), "2005-05-03");
  assert.equal(shareDateValue(start + 0.4, start), null, "The beginning UTC day is omitted");
});

test("replaceShareUrl updates search in place and keeps pathname and hash", () => {
  const location = { pathname: "/Orrery/", search: "?extra=keep", hash: "#view" };
  const history = {
    state: { keep: true },
    replaceState(state, title, url) {
      this.calls = [...this.calls ?? [], { state, title, url }];
      const parsed = new URL(url, "https://example.test");
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      location.hash = parsed.hash;
    },
  };
  replaceShareUrl({ renderer: "pixi", date: "2005-05-03" }, location, history);
  assert.equal(history.calls.length, 1);
  assert.equal(history.calls[0].state, history.state);
  assert.equal(history.calls[0].title, "");
  const params = new URL(history.calls[0].url, "https://example.test").searchParams;
  assert.equal(params.get("renderer"), "pixi");
  assert.equal(params.get("date"), "2005-05-03");
  assert.equal(params.get("extra"), "keep");
  assert.equal(location.hash, "#view");
  assert.equal(location.pathname, "/Orrery/");
  replaceShareUrl({ renderer: "pixi", date: "2005-05-03" }, location, history);
  assert.equal(history.calls.length, 1, "Matching URLs do not replace again");
  replaceShareUrl({ renderer: "three", date: null }, location, history);
  assert.equal(history.calls.at(-1).url, "/Orrery/?extra=keep#view");
  replaceShareUrl({ renderer: "unknown", date: null }, location, history);
  assert.equal(history.calls.at(-1).url, "/Orrery/?extra=keep&renderer=unknown#view");
});

test("formatIsoDay round-trips through parseIsoDay for four-digit years", () => {
  assert.equal(parseIsoDay(formatIsoDay(jumped))?.toISOString(), "2005-05-03T00:00:00.000Z");
});
