import { describe as group, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { skipReport } from "../parse/skip-report";
import {
	DEFAULT_PARSE_OPTIONS,
	VAULT_SCOPE,
	type NoteInput,
	type ParseOptions,
} from "../model/types";

/**
 * A skip rule means the same on every wheel (BC_E3_S167, audit 6 sep 2026).
 *
 * Three places read the rule: the tasks in `buildTree`, the outline in
 * `outlineGroups`, and the report. Two read the full heading path and the third
 * stripped the note's title heading first — which matters for exactly one case,
 * and got it wrong: a note whose own title matches a rule. The vault wheel drew
 * nothing from it and its own wheel drew two empty wedges, of the same note.
 */

const PATH = "Werk/Acceptatiecriteria.md";

const NOTES: NoteInput[] = [
	{
		path: PATH,
		content: [
			"# Acceptatiecriteria",
			"",
			"## Ronde 1",
			"- [ ] Eerste punt",
			"",
			"## Ronde 2",
			"- [ ] Tweede punt",
		].join("\n"),
	},
];

const RULE: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeHeadings: ["*criteria"],
};

const wheel = (options: ParseOptions) => buildTree(NOTES, options);

group("a skip rule that matches the note's own title", () => {
	it("takes the same work out of the vault wheel and the note wheel", () => {
		const vault = wheel({ ...RULE, scope: VAULT_SCOPE });
		const note = wheel({ ...RULE, scope: { kind: "note", path: PATH } });

		expect(vault.root.shownTaskCount).toBe(0);
		expect(note.root.shownTaskCount).toBe(0);
		// The measured symptom: the note wheel drew "Ronde 1" and "Ronde 2" as
		// empty wedges while the vault wheel drew nothing at all.
		expect(note.root.children.map((child) => child.label)).toEqual([]);
	});

	it("counts it as out of the round rather than filtered away", () => {
		// A skip rule is a boundary, not a filter: what falls outside was never in
		// the round, so "0 shown, 0 filtered out" is the honest pair here.
		for (const scope of [VAULT_SCOPE, { kind: "note", path: PATH } as const]) {
			expect(wheel({ ...RULE, scope }).filteredOut).toBe(0);
		}
	});

	it("agrees with the report, which already read the full path", () => {
		const report = skipReport(NOTES, { ...RULE, scope: VAULT_SCOPE });
		expect(report.skipped).toBe(2);
		expect(report.headings[0]?.examples).toContain("Acceptatiecriteria");
	});

	/**
	 * And the note wheel still draws its own outline when nothing is skipped.
	 *
	 * The frame of an empty note is what `outlineGroups` is for (BC_E3_S85), and
	 * a fix that tightened a rule until that frame disappeared would trade one
	 * silence for another.
	 */
	it("leaves the outline alone when no rule matches", () => {
		const note = buildTree(NOTES, {
			...DEFAULT_PARSE_OPTIONS,
			scope: { kind: "note", path: PATH },
		});
		expect(note.root.children.map((child) => child.label)).toEqual([
			"Ronde 1",
			"Ronde 2",
		]);
	});

	/**
	 * A rule matching a heading *inside* the note still behaves as it did.
	 *
	 * The change is about the title step only; everything below it was already
	 * read the same way on both wheels, and this pins that it stayed that way.
	 */
	it("still takes out one section without taking out the note", () => {
		const options: ParseOptions = {
			...DEFAULT_PARSE_OPTIONS,
			excludeHeadings: ["Ronde 2"],
			scope: { kind: "note", path: PATH },
		};
		const note = buildTree(NOTES, options);
		expect(note.root.children.map((child) => child.label)).toEqual(["Ronde 1"]);
		expect(note.root.shownTaskCount).toBe(1);
	});
});
