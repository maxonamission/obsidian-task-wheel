import { describe as group, expect, it } from "vitest";
import { renameHeading } from "../parse/outline-edit";

/**
 * Rewriting what a heading is called (BC_E3_S119).
 *
 * The owner asked whether document names, headings and tags should become
 * editable from the card. Headings: yes — you are standing on it, it is one
 * line in the note you are reviewing, and the typo you just spotted should not
 * cost you a tab.
 *
 * The level is the part that must not move. Everything under a `##` hangs
 * there because of those two characters, so a rename that touched them would
 * silently reparent half a note. Promoting and demoting is `moveHeadingUnder`'s
 * job, and keeping the two apart is what makes this one safe.
 */

const NOTE = [
	"# Plan",
	"",
	"## Deze week",
	"- [ ] Bellen",
	"",
	"### Onder deze week",
	"- [ ] Mailen",
];

group("the level survives, whatever the name becomes", () => {
	it("rewrites the words and leaves the hashes alone", () => {
		expect(renameHeading(NOTE, 2, "Volgende week")).toEqual([
			"# Plan",
			"",
			"## Volgende week",
			"- [ ] Bellen",
			"",
			"### Onder deze week",
			"- [ ] Mailen",
		]);
	});

	it("keeps a deeper heading deep", () => {
		const out = renameHeading(NOTE, 5, "Nog dieper");
		expect(out?.[5]).toBe("### Nog dieper");
	});

	it("touches nothing but the one line", () => {
		const out = renameHeading(NOTE, 2, "Iets anders");
		expect(out?.filter((line, at) => line !== NOTE[at])).toHaveLength(1);
	});
});

group("what the reader types is cleaned, not trusted", () => {
	it("takes off the hashes someone retyped from what they saw", () => {
		// Retyping a heading means typing what is on screen, hashes and all.
		// Taking that literally would write "## ## Deze week".
		expect(renameHeading(NOTE, 2, "## Volgende week")?.[2]).toBe(
			"## Volgende week",
		);
	});

	it("does not let a typed level override the real one", () => {
		// Even six hashes on a second-level heading: the level is read off the
		// note, never off the field. Changing depth is a different action.
		expect(renameHeading(NOTE, 2, "###### Volgende week")?.[2]).toBe(
			"## Volgende week",
		);
	});

	it("takes off closing hashes, which markdown treats as syntax", () => {
		expect(renameHeading(NOTE, 2, "Volgende week ##")?.[2]).toBe(
			"## Volgende week",
		);
	});

	it("folds a pasted line break into a space", () => {
		// The card's editor is a textarea, so a line break is reachable — and a
		// heading is one line by definition.
		expect(renameHeading(NOTE, 2, "Volgende\nweek")?.[2]).toBe(
			"## Volgende week",
		);
	});
});

group("three ways to refuse, each its own", () => {
	it("refuses a line that is not a heading", () => {
		expect(renameHeading(NOTE, 3, "Bellen maar")).toBeNull();
		expect(renameHeading(NOTE, 1, "Iets")).toBeNull();
		expect(renameHeading(NOTE, 99, "Iets")).toBeNull();
	});

	it("refuses a name with nothing readable left in it", () => {
		// A heading of only hashes is not a heading with an empty name; it is a
		// line the note can no longer be read by.
		expect(renameHeading(NOTE, 2, "###")).toBeNull();
		expect(renameHeading(NOTE, 2, "   ")).toBeNull();
		expect(renameHeading(NOTE, 2, "")).toBeNull();
	});

	it("refuses a name that is already the name", () => {
		expect(renameHeading(NOTE, 2, "Deze week")).toBeNull();
		// Including the form the reader is most likely to type it back in.
		expect(renameHeading(NOTE, 2, "## Deze week")).toBeNull();
	});
});
