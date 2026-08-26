import { describe, expect, it } from "vitest";
import { openLink, withLink } from "../parse/link-query";

/**
 * The half-typed link under the cursor (BC_E3_S29).
 *
 * A cursor is written `‸` in these cases, and the tests split on it — so the
 * case reads the way it looks on screen. Not `|`: that is the alias bar, which
 * is one of the things being tested.
 */
const at = (written: string): { text: string; caret: number } => {
	const caret = written.indexOf("‸");
	expect(caret).toBeGreaterThanOrEqual(0);
	return { text: written.replace("‸", ""), caret };
};

const open = (written: string) => {
	const { text, caret } = at(written);
	return openLink(text, caret);
};

describe("openLink — is there a link being typed here", () => {
	it("finds one the moment the brackets are there", () => {
		expect(open("Lezen [[‸")).toEqual({ from: 6, to: 8, query: "" });
	});

	it("hands back what has been typed into it", () => {
		expect(open("Lezen [[week‸")?.query).toBe("week");
	});

	it("finds nothing in a line without brackets", () => {
		expect(open("Gewoon een taak‸")).toBeNull();
	});

	it("finds nothing once the link is closed", () => {
		expect(open("Lezen [[week-01]] en dan‸")).toBeNull();
	});

	it("takes the second of two, not the first", () => {
		const found = open("[[week-01]] en [[wee‸");
		expect(found?.query).toBe("wee");
		expect(found?.from).toBe(15);
	});

	it("is still open with the closing brackets already typed after it", () => {
		// Somebody who types both halves first and the name second is writing a
		// link like anybody else.
		expect(open("Lezen [[wee‸]]")?.query).toBe("wee");
	});

	it("stops at an alias bar — those are the writer's own words", () => {
		expect(open("Lezen [[week-01|‸")).toBeNull();
	});

	it("stops at a heading mark — headings are not offered here", () => {
		expect(open("Lezen [[week-01#‸")).toBeNull();
	});

	it("does not run over a line break", () => {
		expect(open("Lezen [[\nweek‸")).toBeNull();
	});

	it("does not mistake a single bracket for an opening", () => {
		expect(open("Zie [week‸")).toBeNull();
	});
});

describe("withLink — the line once a note has been chosen", () => {
	const chose = (written: string, name: string) => {
		const { text, caret } = at(written);
		const found = openLink(text, caret);
		expect(found).not.toBeNull();
		return withLink(text, found as NonNullable<typeof found>, name);
	};

	it("writes the whole link in, brackets and all", () => {
		expect(chose("Lezen [[wee‸", "week-01").text).toBe("Lezen [[week-01]]");
	});

	it("puts the cursor after it, where the writing carries on", () => {
		const done = chose("Lezen [[wee‸", "week-01");
		expect(done.caret).toBe(done.text.length);
		expect(done.text.slice(0, done.caret)).toBe("Lezen [[week-01]]");
	});

	it("takes up closing brackets that were already there", () => {
		expect(chose("Lezen [[wee‸]]", "week-01").text).toBe("Lezen [[week-01]]");
	});

	it("keeps whatever came after the link", () => {
		const done = chose("Lezen [[wee‸ vandaag 📅 2026-08-20", "week-01");
		expect(done.text).toBe("Lezen [[week-01]] vandaag 📅 2026-08-20");
		expect(done.text.slice(done.caret)).toBe(" vandaag 📅 2026-08-20");
	});

	it("replaces only its own link, never the one before it", () => {
		expect(chose("[[week-01]] en [[wee‸", "week-02").text).toBe(
			"[[week-01]] en [[week-02]]",
		);
	});

	it("writes a name that was never typed at all", () => {
		expect(chose("Lezen [[‸", "week-01").text).toBe("Lezen [[week-01]]");
	});
});
