import { describe, expect, it } from "vitest";
import { isRefused, scopeFor, type TappedNode } from "../model/scope";
import { VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * What a second tap opens, and — the part that broke — what it refuses.
 *
 * The wedge branch used to ask "did the domain come from a tag?" and answer
 * "then it is a folder" for everything else. That was true while there were two
 * sources. A front-matter property arrived as a third (BC_E3_S81) and nothing
 * said a word: a wedge called `Work` claimed to be a folder called `Work`, and
 * the wheel went looking for one that need not exist (BC_E3_S92).
 */

const WEDGE: TappedNode = { kind: "domain", depth: 1, label: "Work" };

const TASK: TappedNode = {
	kind: "task",
	depth: 3,
	label: "Call the plumber",
	source: {
		path: "Werk/Plan.md",
		line: 4,
		indent: 0,
		headingPath: ["Klanten"],
		raw: "- [ ] Call the plumber",
	},
};

const HEADING: TappedNode = {
	kind: "group",
	depth: 2,
	label: "Klanten",
	source: {
		path: "Werk/Plan.md",
		line: 2,
		indent: 0,
		headingPath: ["Werk"],
		raw: "## Klanten",
	},
};

const NOTE_WHEEL: WheelScope = { kind: "note", path: "Werk/Plan.md" };

describe("what a second tap opens", () => {
	it("makes a folder wheel of a folder domain", () => {
		expect(scopeFor(WEDGE, VAULT_SCOPE, "folder")).toEqual({
			kind: "folder",
			path: "Work",
		});
	});

	it("grows the path when the wheel is already inside a folder", () => {
		expect(
			scopeFor(WEDGE, { kind: "folder", path: "Projecten" }, "folder"),
		).toEqual({ kind: "folder", path: "Projecten/Work" });
	});

	it("refuses a tag domain, because a tag is not a place on disk", () => {
		const answer = scopeFor(WEDGE, VAULT_SCOPE, "tag");

		expect(isRefused(answer)).toBe(true);
		expect(answer).toEqual({ refused: "not-a-folder", source: "tag" });
	});

	it("refuses a property domain for exactly the same reason", () => {
		const answer = scopeFor(WEDGE, VAULT_SCOPE, "property");

		expect(isRefused(answer)).toBe(true);
		expect(answer).toEqual({ refused: "not-a-folder", source: "property" });
	});

	it("makes a note wheel of anything carrying a source", () => {
		expect(scopeFor(TASK, VAULT_SCOPE, "folder")).toEqual({
			kind: "note",
			path: "Werk/Plan.md",
		});
	});

	it("makes a section wheel of a heading in a note's own wheel", () => {
		expect(scopeFor(HEADING, NOTE_WHEEL, "folder")).toEqual({
			kind: "section",
			path: "Werk/Plan.md",
			heading: ["Werk", "Klanten"],
		});
	});

	it("refuses the bucket above the first heading", () => {
		const bucket: TappedNode = {
			kind: "domain",
			depth: 1,
			label: "(no heading)",
			source: {
				path: "Werk/Plan.md",
				line: 0,
				indent: 0,
				headingPath: [],
				raw: null,
			},
		};

		expect(scopeFor(bucket, NOTE_WHEEL, "folder")).toEqual({
			refused: "no-section",
		});
	});

	it("refuses an item that says nothing about where it came from", () => {
		const orphan: TappedNode = { kind: "project", depth: 2, label: "Plan" };

		expect(scopeFor(orphan, VAULT_SCOPE, "folder")).toEqual({
			refused: "no-source",
		});
	});
});
