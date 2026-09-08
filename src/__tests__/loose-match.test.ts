import { describe as group, expect, it } from "vitest";
import { looselyMatches } from "../parse/glob";
import { matchHint } from "../view/filter-labels";
import { matches } from "../parse/filter";
import { parseTaskLine } from "../parse/task-line";
import { NO_FILTER, type TaskFilter } from "../model/types";

/**
 * The three boxes of the filter panel, measured against one task (BC_E3_S181).
 *
 * The table below is the owner's report of 8 sep 2026 written out: typing `may`
 * found nothing in the tag box while `#maybe` sat on the task, and typing part
 * of a heading found nothing either, while the words box directly above them
 * had always been happy with part of a word.
 */

const TODAY = "2026-09-08";
const PATH = ["Beheer", "Project bonnetjes"];

function fields(line: string) {
	const parsed = parseTaskLine(line);
	if (parsed === null) throw new Error(`not a task line: ${line}`);
	return parsed.fields;
}

const task = fields("- [ ] Bonnetjes scannen #maybe");

function hits(over: Partial<TaskFilter>): boolean {
	return matches(
		task,
		{ ...NO_FILTER, withTags: [], withoutTags: [], ...over },
		TODAY,
		"Bonnetjes.md",
		PATH,
	);
}

group("the three filter boxes, on one task", () => {
	it("finds part of a word in the words box, as it always did", () => {
		expect(hits({ text: "may" })).toBe(true);
		expect(hits({ text: "bonnet" })).toBe(true);
		expect(hits({ text: "may*" })).toBe(true);
	});

	it("finds a tag from its start, which is what the report asked for", () => {
		expect(hits({ withTags: ["may"] })).toBe(true);
		expect(hits({ withTags: ["maybe"] })).toBe(true);
		expect(hits({ withTags: ["#maybe"] })).toBe(true);
		// The star the box would not take before.
		expect(hits({ withTags: ["may*"] })).toBe(true);
	});

	it("does not find a tag by its middle without being asked", () => {
		const other = fields("- [ ] Iets anders #thuismaybe");
		const rule = { ...NO_FILTER, withTags: ["may"], withoutTags: [] };
		expect(matches(other, rule, TODAY, "N.md", PATH)).toBe(false);
	});

	it("finds part of a heading", () => {
		expect(hits({ heading: "Proj" })).toBe(true);
		expect(hits({ heading: "bonnetjes" })).toBe(true);
		expect(hits({ heading: "Project bonnetjes" })).toBe(true);
		expect(hits({ heading: "Project*" })).toBe(true);
		expect(hits({ heading: "Beheer" })).toBe(true);
	});

	it("still leaves out what the reader did not ask for", () => {
		expect(hits({ heading: "kwartaal" })).toBe(false);
		expect(hits({ withTags: ["werk"] })).toBe(false);
		expect(hits({ text: "offerte" })).toBe(false);
	});

	/**
	 * The exclusion list reads the same rule as the inclusion list.
	 *
	 * Two lists, one question — if they answered it differently, a tag could be
	 * both wanted and unwanted at once, and the wheel would show work the reader
	 * had told it twice to leave out.
	 */
	it("excludes on the same rule it includes on", () => {
		expect(hits({ withoutTags: ["may"] })).toBe(false);
		expect(hits({ withoutTags: ["werk"] })).toBe(true);
	});
});

group("looselyMatches", () => {
	it("reads a bare word as 'anywhere' or 'from the start', as asked", () => {
		expect(looselyMatches("project bonnetjes", "bonnetjes", "anywhere")).toBe(true);
		expect(looselyMatches("project bonnetjes", "bonnetjes", "prefix")).toBe(false);
		expect(looselyMatches("maybe", "may", "prefix")).toBe(true);
		expect(looselyMatches("thuismaybe", "may", "prefix")).toBe(false);
	});

	it("keeps the namespace rule a namespace rule", () => {
		expect(looselyMatches("werk/klant", "werk", "prefix")).toBe(true);
		expect(looselyMatches("werk", "werk/klant", "prefix")).toBe(false);
	});

	/**
	 * A star may widen a box, never narrow it.
	 *
	 * The reader reaches for one to ask for *more*, so a pattern is loosened the
	 * same way a bare word is. Without that, `may*` in the prefix box would be
	 * exactly as wide as `may` — and `*urgent` would be narrower than `urgent`,
	 * which is the opposite of what typing a star means.
	 */
	it("never makes a box stricter than leaving the star out", () => {
		for (const how of ["anywhere", "prefix"] as const) {
			for (const [name, bare] of [
				["werkgroep", "werk"],
				["project bonnetjes", "project"],
			] as const) {
				if (looselyMatches(name, bare, how)) {
					expect(looselyMatches(name, `${bare}*`, how)).toBe(true);
				}
			}
		}
		// And the star reaches what the bare word could not.
		expect(looselyMatches("werkgroep", "*groep", "prefix")).toBe(true);
		expect(looselyMatches("werkgroep", "groep", "prefix")).toBe(false);
	});

	it("refuses a box holding nothing but stars, which would select everything", () => {
		expect(looselyMatches("anything", "", "anywhere")).toBe(false);
		expect(looselyMatches("anything", "  ", "prefix")).toBe(false);
		expect(looselyMatches("anything", "*", "anywhere")).toBe(false);
		expect(looselyMatches("anything", "**", "prefix")).toBe(false);
	});
});

/**
 * The sentence the panel shows, checked against what the filter does.
 *
 * The point of building it from `HEADING_MATCH` and `TAG_MATCH` is that it
 * cannot drift; this is the test that says so out loud. If someone flips a
 * box's rule and the hint keeps its old wording, one of these fails.
 */
group("the hint under the boxes", () => {
	it("says what the heading box actually does", () => {
		const claim = matchHint();
		const partial = hits({ heading: "bonnetjes" });
		expect(claim.includes("headings match part of a name")).toBe(partial);
	});

	it("says what the tag box actually does", () => {
		const claim = matchHint();
		const fromStart = hits({ withTags: ["may"] }) && !looselyMatches("thuismaybe", "may", "prefix");
		expect(claim.includes("a tag matches from its start")).toBe(fromStart);
	});

	it("mentions the star, which all three boxes take", () => {
		expect(matchHint()).toContain("*");
		expect(hits({ text: "may*" })).toBe(true);
		expect(hits({ heading: "Project*" })).toBe(true);
		expect(hits({ withTags: ["may*"] })).toBe(true);
	});
});
