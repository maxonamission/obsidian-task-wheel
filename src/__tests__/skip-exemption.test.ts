import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { isExcluded } from "../parse/domain";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
} from "../model/types";

/**
 * A skip rule is a default, not a wall (BC_E3_S151).
 *
 * *"Type checklist is geen taak, maar wil je die notities ook buiten een wiel
 * kunnen houden… tenzij je expliciet opdracht geeft om een wiel op die notitie
 * te tekenen?"* (eigenaar, 6 sep 2026).
 *
 * The old rule held the skip lists inside every scope, and read on its own that
 * is sound: "never review this folder" should not stop being true because you
 * zoomed in. Measuring where it bites settles it the other way. A skipped note
 * is drawn nowhere, so there is no wedge to zoom into — the only way to a wheel
 * over it is the file menu or the command, which is a reader naming it out loud.
 * That act used to answer with an empty circle and not a word.
 */

const NOTES: NoteInput[] = [
	{ path: "Werk/Plan.md", content: "- [ ] Bellen" },
	{ path: "Werk/Sjabloon.md", content: "- [ ] Punt een", frontmatterType: "checklist" },
	{ path: "Archief/Oud.md", content: "- [ ] Iets ouds" },
	{ path: "Archief/Sjabloon.md", content: "- [ ] Punt", frontmatterType: "checklist" },
	{ path: "Archief/Dieper/Weg.md", content: "- [ ] Nog dieper" },
];

const SKIPPING: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	excludeNoteTypes: ["checklist"],
	excludeFolders: ["Archief", "Archief/Dieper"],
};

function work(tree: { root: WheelNode }): string[] {
	const out: string[] = [];
	const walk = (node: WheelNode): void => {
		if (node.kind === "task") out.push(node.label);
		node.children.forEach(walk);
	};
	tree.root.children.forEach(walk);
	return out.sort();
}

describe("the skip lists on a wheel nobody asked for", () => {
	it("leave out the skipped types and folders, as they always did", () => {
		expect(work(buildTree(NOTES, SKIPPING))).toEqual(["Bellen"]);
	});
});

describe("the wheel you pointed at something", () => {
	it("draws a skipped note when that note is what you named", () => {
		const tree = buildTree(NOTES, {
			...SKIPPING,
			scope: { kind: "note", path: "Werk/Sjabloon.md" },
		});

		expect(work(tree)).toEqual(["Punt een"]);
	});

	it("draws a skipped folder's notes when that folder is what you named", () => {
		const tree = buildTree(NOTES, {
			...SKIPPING,
			scope: { kind: "folder", path: "Archief" },
		});

		// Not the checklist inside it: you asked for the folder, not for that
		// note. And not the deeper skipped folder, which you did not name either.
		expect(work(tree)).toEqual(["Iets ouds"]);
	});

	it("exempts only the entry that covers what you named", () => {
		// Standing on the deeper one, its own rule steps aside — and the one
		// above it steps aside with it, because it covers this folder too.
		const tree = buildTree(NOTES, {
			...SKIPPING,
			scope: { kind: "folder", path: "Archief/Dieper" },
		});

		expect(work(tree)).toEqual(["Nog dieper"]);
	});

	it("keeps the exemption on every rung of the ladder, headings included", () => {
		// Asked of `isExcluded` rather than of a drawn tree, because a heading
		// wheel also narrows to its own heading and that would answer for the
		// wrong reason.
		//
		// It did not keep it: the exemption held on a folder wheel, fell away on
		// a heading wheel inside that folder, and came back on the note wheel one
		// rung lower. `named` listed three of the five kinds of scope and the
		// heading rung of BC_E3_S146 sat in the silent else, so a reader who
		// opened a skipped folder and tapped a wedge got the empty circle
		// BC_E3_S151 removed, one tap further on (found by audit, 6 sep 2026).
		const note = NOTES[2];
		const rungs: [string, ParseOptions["scope"]][] = [
			["folder", { kind: "folder", path: "Archief" }],
			["heading", { kind: "heading", heading: "Nu", path: "Archief" }],
			["note", { kind: "note", path: "Archief/Oud.md" }],
			["section", { kind: "section", path: "Archief/Oud.md", heading: ["Nu"] }],
		];

		for (const [name, scope] of rungs) {
			expect(isExcluded(note, { ...SKIPPING, scope }), `rung ${name}`).toBe(false);
		}

		// And the vault, which named nothing, still holds the rule.
		expect(isExcluded(note, { ...SKIPPING, scope: { kind: "vault" } })).toBe(true);
	});

	it("names nothing on a heading wheel opened from the vault", () => {
		// Its path is empty, so the reader never said a folder out loud and the
		// skip list still holds: the exemption is for what you pointed at.
		expect(
			isExcluded(NOTES[2], {
				...SKIPPING,
				scope: { kind: "heading", heading: "Nu", path: "" },
			}),
		).toBe(true);
	});

	it("still keeps out what lies outside the scope entirely", () => {
		const tree = buildTree(NOTES, {
			...SKIPPING,
			scope: { kind: "note", path: "Werk/Sjabloon.md" },
		});

		expect(work(tree)).not.toContain("Bellen");
	});
});
