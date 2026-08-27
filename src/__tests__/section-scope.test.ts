import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { hasHeadingPath } from "../parse/outline";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	outward,
	type ParseOptions,
	scopeKey,
	scopeLabel,
	type WheelScope,
} from "../model/types";

/**
 * The section wheel — the fourth rung of the blikveld ladder (BC_E3_S64).
 *
 * Same shape as the note wheel, one path deeper: the section's subheadings
 * are the wedges, tasks elsewhere in the note are a boundary like the scope
 * itself, and the anchor is the full heading path because a bare title is
 * not an identity.
 */

const NOTE: NoteInput = {
	path: "Werk/Plan.md",
	content: [
		"- [ ] Boven elk kopje",
		"# Werk",
		"- [ ] Direct onder Werk",
		"## KNSB",
		"- [ ] Jaarplan lezen",
		"### Details",
		"- [ ] Bijlage checken",
		"## NOC",
		"- [ ] Bellen",
		"# Thuis",
		"## KNSB",
		"- [ ] Zelfde naam, ander pad",
	].join("\n"),
};

function section(heading: string[]): WheelScope {
	return { kind: "section", path: NOTE.path, heading };
}

function options(scope: WheelScope, over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, scope, ...over };
}

describe("a wheel over one section", () => {
	it("holds the section's tasks, subheadings included, and nothing else", () => {
		const tree = buildTree([NOTE], options(section(["Werk"])));
		const labels = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label);

		expect(labels.sort()).toEqual([
			"Bellen",
			"Bijlage checken",
			"Direct onder Werk",
			"Jaarplan lezen",
		]);
	});

	it("makes the subheadings the wedges, exactly like the note wheel one deeper", () => {
		const tree = buildTree([NOTE], options(section(["Werk"])));
		// "Direct onder Werk" has no subheading and lands in the fallback wedge.
		expect(tree.domains.sort()).toEqual(["KNSB", "NOC", "Overig"]);
	});

	it("turns a sub-subheading into a ring inside its wedge", () => {
		const tree = buildTree([NOTE], options(section(["Werk"])));
		const details = [...tree.byId.values()].find(
			(node) => node.kind === "group" && node.label === "Details",
		);
		expect(details).toBeDefined();
		expect(details?.domain).toBe("KNSB");
	});

	it("tells sections with the same title apart by their full path", () => {
		const tree = buildTree([NOTE], options(section(["Werk", "KNSB"])));
		const labels = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label);

		expect(labels.sort()).toEqual(["Bijlage checken", "Jaarplan lezen"]);
	});

	it("keeps the sources absolute, so a wedge can become a wheel of its own", () => {
		const tree = buildTree([NOTE], options(section(["Werk"])));
		const knsb = tree.root.children.find((child) => child.label === "KNSB");
		// The wedge's own heading line, with the path *above* it — together
		// they name the section completely, whatever depth this wheel sits at.
		expect(knsb?.source?.headingPath).toEqual(["Werk"]);
		expect(knsb?.source?.raw).toBe("## KNSB");
	});

	it("still runs the skip rules on the full heading paths", () => {
		const tree = buildTree(
			[NOTE],
			options(section(["Werk"]), { excludeHeadings: ["knsb"] }),
		);
		const labels = [...tree.byId.values()]
			.filter((node) => node.kind === "task")
			.map((node) => node.label);

		expect(labels.sort()).toEqual(["Bellen", "Direct onder Werk"]);
	});

	it("says the section is gone when the note no longer holds the path", () => {
		const tree = buildTree([NOTE], options(section(["Werk", "Weg"])));
		expect(tree.sectionMissing).toBe(true);
	});

	it("calls an empty section empty, never gone", () => {
		const empty: NoteInput = {
			path: NOTE.path,
			content: ["# Werk", "## Leeg", "tekst zonder taken"].join("\n"),
		};
		const tree = buildTree([empty], options(section(["Werk", "Leeg"])));
		expect(tree.sectionMissing).toBe(false);
		expect(tree.root.shownTaskCount).toBe(0);
	});

	it("leaves the flag off every other scope", () => {
		const tree = buildTree([NOTE], options({ kind: "note", path: NOTE.path }));
		expect(tree.sectionMissing).toBeUndefined();
	});
});

describe("the section scope itself", () => {
	it("keys on the full path, so two sections sharing a title keep their own round", () => {
		expect(scopeKey(section(["Werk", "KNSB"]))).not.toBe(
			scopeKey(section(["Thuis", "KNSB"])),
		);
	});

	it("is called by its own heading", () => {
		expect(scopeLabel(section(["Werk", "KNSB"]))).toBe("KNSB");
	});

	it("goes out to its note — one rung, not straight to the folder", () => {
		expect(outward(section(["Werk", "KNSB"]))).toEqual({
			kind: "note",
			path: NOTE.path,
		});
	});
});

describe("hasHeadingPath", () => {
	it("finds a nested path and refuses a near miss", () => {
		expect(hasHeadingPath(NOTE.content, ["Werk", "KNSB", "Details"])).toBe(true);
		expect(hasHeadingPath(NOTE.content, ["KNSB"])).toBe(false);
		expect(hasHeadingPath(NOTE.content, ["Werk", "Details"])).toBe(false);
	});

	it("does not read a heading inside a code fence", () => {
		const fenced = ["# Echt", "```", "# Nep", "```"].join("\n");
		expect(hasHeadingPath(fenced, ["Echt"])).toBe(true);
		expect(hasHeadingPath(fenced, ["Nep"])).toBe(false);
	});
});
