import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The race the write path did not cover, in its three shapes (BC_E3_S44).
 *
 * The wheel is drawn from a scan that may be minutes old, and every write
 * checked the line the reader was standing on. Nothing checked the *other*
 * lines an edit depends on — the heading a picker named, the parent task it
 * named — nor whether the line the wheel remembered still held what the wheel
 * was showing. So a note that shifted in between (a sync, an editor in a split
 * pane) could have the edit carried out faultlessly on the wrong thing, and
 * reported as a success (audit, 23 aug 2026).
 *
 * Every case here is written twice: what happens now, and what the old rule
 * would have done with the same note. The second half is the part that says
 * these tests are not vacuous.
 */

/** What the pickers "answer". `null` stands for backing out. */
const picked = {
	note: null as string | null,
	destination: null as { kind: "keep" } | null,
};

vi.mock("../view/note-picker", async () => ({
	...(await vi.importActual<typeof import("../view/note-picker")>(
		"../view/note-picker",
	)),
	pickNote: () => Promise.resolve(picked.note),
	noteFor: (_app: unknown, path: string) =>
		Promise.resolve(notes.has(path) ? fileFor(path) : null),
}));

vi.mock("../view/heading-picker", async () => ({
	...(await vi.importActual<typeof import("../view/heading-picker")>(
		"../view/heading-picker",
	)),
	pickDestination: () =>
		Promise.resolve({ shown: true, choice: picked.destination }),
}));

import { TFile } from "obsidian";
import { layoutWheel } from "../layout/radial";
import type { AfterWrite } from "../model/carry";
import { DEFAULT_PARSE_OPTIONS } from "../model/types";
import { buildTree } from "../parse/build-tree";
import { moveHeadingUnder, moveToSection, moveUnderTask } from "../parse/outline-edit";
import { stillThere } from "../parse/splice";
import { type CarryHost, carryTo, whatTravels } from "../view/carry-flow";
import {
	writeMoveTo,
	writeMoveUnder,
	writeSection,
	type LineRef,
} from "../vault/writeback";

const notes = new Map<string, string>();

const fileFor = (path: string): TFile => {
	const file = new TFile();
	file.path = path;
	file.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
	file.extension = "md";
	return file;
};

const vault = {
	getAbstractFileByPath: (path: string): TFile | null =>
		notes.has(path) ? fileFor(path) : null,
	read: (file: TFile): Promise<string> =>
		Promise.resolve(notes.get(file.path) ?? ""),
	cachedRead: (file: TFile): Promise<string> =>
		Promise.resolve(notes.get(file.path) ?? ""),
	process: (file: TFile, fn: (data: string) => string): Promise<string> => {
		const next = fn(notes.get(file.path) ?? "");
		notes.set(file.path, next);
		return Promise.resolve(next);
	},
};

const app = { vault } as never;

const NOTE = "Werk/Plan.md";

const linesOf = (path = NOTE): string[] => (notes.get(path) ?? "").split("\n");

const write = (lines: string[], path = NOTE): void => {
	notes.set(path, lines.join("\n"));
};

/** The node the wheel draws for `label`, from the notes as they stand. */
function nodeFor(label: string) {
	const tree = buildTree(
		[...notes].map(([path, content]) => ({ path, content })),
		DEFAULT_PARSE_OPTIONS,
	);
	const laid = layoutWheel(tree).nodes.find((one) => one.node.label === label);
	if (laid === undefined) throw new Error(`no node labelled ${label}`);
	return laid;
}

beforeEach(() => {
	notes.clear();
	picked.note = null;
	picked.destination = null;
});

/* ------------------------------------------------------------------ */
/* V1 — the line a picker named                                        */
/* ------------------------------------------------------------------ */

describe("a target chosen from a picker", () => {
	/**
	 * The note as the picker saw it, and as it is by the time we write: three
	 * lines have gone from above the target, so `## Later` is where `## Archief`
	 * now sits. Line 0 — the task — is untouched, so the old check passed.
	 */
	const asPicked = [
		"- [ ] Bellen",
		"- [ ] Een",
		"- [ ] Twee",
		"- [ ] Drie",
		"## Later",
		"- [ ] Al iets",
		"## Archief",
		"- [ ] Oud",
	];

	/** Two lines gone from between the task and the target, so line 4 is now
	 * `## Archief`. Line 0 is untouched, which is all the old check looked at. */
	const shifted = [
		"- [ ] Bellen",
		"- [ ] Drie",
		"## Later",
		"- [ ] Al iets",
		"## Archief",
		"- [ ] Oud",
	];

	const bellen = (): LineRef => ({ path: NOTE, line: 0, raw: "- [ ] Bellen" });

	it("moves the task when the note is still as it was", async () => {
		write(asPicked);

		const outcome = await writeMoveTo(app, bellen(), {
			line: 4,
			raw: "## Later",
		});

		expect(outcome).toBe("written");
		expect(linesOf()).toContain("- [ ] Bellen");
		// Under Later, which is what was asked for.
		expect(linesOf().indexOf("- [ ] Bellen")).toBeGreaterThan(
			linesOf().indexOf("## Later"),
		);
	});

	it("refuses when another heading has moved into that line", async () => {
		write(shifted);

		const outcome = await writeMoveTo(app, bellen(), {
			line: 4,
			raw: "## Later",
		});

		expect(outcome).toBe("stale");
		// And nothing was written: the note is exactly as it came in.
		expect(linesOf()).toEqual(shifted);
	});

	it("would have landed under the wrong heading without the anchor", () => {
		// The rule underneath, asked directly with the line number the picker
		// gave: it only ever asked whether there is *a* heading there.
		const moved = moveToSection(shifted, 0, 4);

		expect(moved).not.toBeNull();
		expect(moved?.indexOf("- [ ] Bellen")).toBeGreaterThan(
			moved?.indexOf("## Archief") ?? -1,
		);
		// Which is not where the reader pointed.
		expect(moved?.indexOf("- [ ] Bellen")).toBeGreaterThan(
			moved?.indexOf("## Later") ?? -1,
		);
	});

	it("refuses a parent task that is no longer the one picked", async () => {
		write(["- [ ] Bellen", "- [ ] Iemand anders", "- [ ] De ouder"]);

		const outcome = await writeMoveUnder(app, bellen(), {
			line: 1,
			raw: "- [ ] De ouder",
		});

		expect(outcome).toBe("stale");
		expect(linesOf()).toEqual([
			"- [ ] Bellen",
			"- [ ] Iemand anders",
			"- [ ] De ouder",
		]);
	});

	it("would have hung it under the neighbour without the anchor", () => {
		const lines = ["- [ ] Bellen", "- [ ] Iemand anders", "- [ ] De ouder"];
		const hung = moveUnderTask(lines, 0, 1);

		// Any task on that line will do, as far as the edit is concerned: it
		// lands indented directly under the neighbour, not under the task the
		// reader picked.
		expect(hung?.[0]).toBe("- [ ] Iemand anders");
		expect(hung?.[1]).toBe("    - [ ] Bellen");
	});

	it("refuses to re-level a section under a heading that has changed", async () => {
		const before = [
			"# Note",
			"## Doel",
			"- [ ] Iets",
			"## Andere kop",
			"### Diep",
		];
		write(before);

		const outcome = await writeSection(
			app,
			{ path: NOTE, line: 1, raw: "## Doel" },
			{ kind: "under", line: 1, target: { line: 3, raw: "## Wat anders" } },
		);

		expect(outcome).toBe("stale");
		expect(linesOf()).toEqual(before);
	});

	it("would have re-levelled the whole section under the wrong parent", () => {
		const lines = [
			"# Note",
			"## Doel",
			"- [ ] Iets",
			"### Onder Doel",
			"## Andere kop",
		];
		const moved = moveHeadingUnder(lines, 1, 4);

		// Not just the heading: everything under it is renumbered to fit.
		expect(moved).not.toBeNull();
		expect(moved).toContain("### Doel");
		expect(moved).toContain("#### Onder Doel");
	});
});

/* ------------------------------------------------------------------ */
/* V2 — the line the wheel remembers standing on                       */
/* ------------------------------------------------------------------ */

describe("the line the wheel is showing", () => {
	it("knows when a line is still itself", () => {
		const lines = ["- [ ] Bellen", "- [ ] Iets anders"];

		expect(stillThere(lines, { line: 0, raw: "- [ ] Bellen" })).toBe(true);
		// Trailing whitespace and a carriage return are not an edit.
		expect(stillThere(lines, { line: 0, raw: "- [ ] Bellen  " })).toBe(true);
		expect(stillThere(lines, { line: 1, raw: "- [ ] Bellen" })).toBe(false);
		expect(stillThere(lines, { line: 9, raw: "- [ ] Bellen" })).toBe(false);
	});

	it("refuses to carry when another task has taken that line", () => {
		write(["- [ ] Bellen", "- [ ] De buurman"]);
		const laid = nodeFor("Bellen");
		const source = laid.node.source;
		if (source === undefined) throw new Error("no source");

		// The scan said line 0; a line has been inserted above since.
		const now = ["- [ ] Er kwam iets bij", "- [ ] Bellen", "- [ ] De buurman"];

		expect(
			whatTravels(now, source, DEFAULT_PARSE_OPTIONS, laid.node.kind),
		).toBeNull();
	});

	it("carries the neighbour away when the anchor is not consulted", () => {
		write(["- [ ] Bellen", "- [ ] De buurman"]);
		const laid = nodeFor("Bellen");
		const source = laid.node.source;
		if (source === undefined) throw new Error("no source");

		const now = ["- [ ] Er kwam iets bij", "- [ ] Bellen", "- [ ] De buurman"];

		// What the old code did: straight to the extraction, line number only.
		const blind = whatTravels(
			now,
			{ ...source, raw: null },
			DEFAULT_PARSE_OPTIONS,
			laid.node.kind,
		);

		expect(blind?.blocks[0].block).toEqual(["- [ ] Er kwam iets bij"]);
	});

	it("still carries when nothing has moved", () => {
		const lines = ["- [ ] Bellen", "- [ ] De buurman"];
		write(lines);
		const laid = nodeFor("Bellen");
		const source = laid.node.source;
		if (source === undefined) throw new Error("no source");

		const travelling = whatTravels(
			lines,
			source,
			DEFAULT_PARSE_OPTIONS,
			laid.node.kind,
		);

		expect(travelling?.blocks[0].block).toEqual(["- [ ] Bellen"]);
	});

	it("remembers the heading line a heading node stands on", () => {
		write(["## Deze week", "- [ ] Bellen"]);

		expect(nodeFor("Deze week").node.source?.raw).toBe("## Deze week");
		expect(nodeFor("Bellen").node.source?.raw).toBe("- [ ] Bellen");
	});
});

/* ------------------------------------------------------------------ */
/* V3 — an aim that outlived the action that set it                    */
/* ------------------------------------------------------------------ */

describe("moving on to the next item", () => {
	/** A host that records what the write asked of the wheel afterwards. */
	function hostRecording(seen: AfterWrite[]): CarryHost {
		return {
			app,
			options: () => DEFAULT_PARSE_OPTIONS,
			trace: () => undefined,
			refresh: () => Promise.resolve(),
			refreshCarrying: (after: AfterWrite = {}) => {
				seen.push(after);
				return Promise.resolve();
			},
		};
	}

	it("leaves no aim behind when the picker is backed out of", async () => {
		write(["- [ ] Bellen", "- [ ] De volgende"]);
		const seen: AfterWrite[] = [];
		picked.note = null;

		carryTo(hostRecording(seen), nodeFor("Bellen"), "move", { advance: true });
		await Promise.resolve();
		await Promise.resolve();

		// Nothing was written, so the wheel was never asked to move on. Under the
		// old shape the aim was worked out *before* this picker opened and sat on
		// the view until some later, unrelated action consumed it.
		expect(seen).toEqual([]);
		expect(linesOf()).toEqual(["- [ ] Bellen", "- [ ] De volgende"]);
	});

	it("passes the aim along when the carry does happen", async () => {
		write(["- [ ] Bellen", "- [ ] De volgende"]);
		notes.set("Werk/Later.md", "# Later\n");
		const seen: AfterWrite[] = [];
		picked.note = "Werk/Later.md";
		picked.destination = { kind: "keep" };

		carryTo(hostRecording(seen), nodeFor("Bellen"), "move", { advance: true });
		for (let i = 0; i < 20; i++) await Promise.resolve();

		expect(seen).toEqual([{ advance: true }]);
		expect(notes.get("Werk/Later.md")).toContain("- [ ] Bellen");
	});

	it("says nothing about moving on for an action that does not finish one", async () => {
		write(["- [ ] Bellen", "- [ ] De volgende"]);
		notes.set("Werk/Later.md", "# Later\n");
		const seen: AfterWrite[] = [];
		picked.note = "Werk/Later.md";
		picked.destination = { kind: "keep" };

		carryTo(hostRecording(seen), nodeFor("Bellen"), "copy");
		for (let i = 0; i < 20; i++) await Promise.resolve();

		expect(seen).toEqual([{}]);
	});
});
