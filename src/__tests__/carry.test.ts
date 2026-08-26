import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { carryFocus, carrySeen, landAfter } from "../model/carry";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
	type WheelTree,
} from "../model/types";

/**
 * Keeping a round's seen-marks across an edit that renames or moves.
 *
 * The seen-mark is the whole promise of the wheel: it is what makes "I have
 * been all the way round" a fact. A node's id is built from its place plus its
 * text, so exactly the edits that change those hand back a node the wheel has
 * never met — and the round walks backwards for no visible reason.
 */

const SCOPE: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	scope: { kind: "note", path: "Werk/Plan.md" },
};

function tree(content: string): WheelTree {
	const note: NoteInput = { path: "Werk/Plan.md", content };
	return buildTree([note], SCOPE);
}

/** The id of the task with these words, in whichever tree. */
function idOf(of: WheelTree, label: string): string {
	for (const [id, node] of of.byId) {
		if (node.kind === "task" && node.label === label) return id;
	}
	throw new Error(`no task called ${label}`);
}

function labelsSeen(of: WheelTree, seen: string[]): string[] {
	return seen
		.map((id) => of.byId.get(id)?.label)
		.filter((label): label is string => label !== undefined)
		.sort();
}

describe("a task that was renamed", () => {
	const before = tree(["## Werk", "- [ ] Bellen", "- [ ] Mailen"].join("\n"));
	const after = tree(
		["## Werk", "- [ ] Loodgieter bellen", "- [ ] Mailen"].join("\n"),
	);
	const rename = { path: "Werk/Plan.md", from: "Bellen", to: "Loodgieter bellen" };

	it("keeps its seen-mark under its new name", () => {
		const seen = [idOf(before, "Bellen")];
		expect(labelsSeen(after, carrySeen(before, after, seen, rename))).toEqual([
			"Loodgieter bellen",
		]);
	});

	it("keeps the reading wedge on it", () => {
		const was = idOf(before, "Bellen");
		expect(carryFocus(before, after, was, rename)).toBe(
			idOf(after, "Loodgieter bellen"),
		);
	});

	it("leaves the other marks of the round alone", () => {
		const seen = [idOf(before, "Bellen"), idOf(before, "Mailen")];
		expect(labelsSeen(after, carrySeen(before, after, seen, rename))).toEqual([
			"Loodgieter bellen",
			"Mailen",
		]);
	});

	it("does not hand the mark to a task that was not renamed", () => {
		const seen = [idOf(before, "Mailen")];
		expect(labelsSeen(after, carrySeen(before, after, seen, rename))).toEqual([
			"Mailen",
		]);
	});
});

describe("a task that moved to another heading", () => {
	const before = tree(
		["## Werk", "- [ ] Bellen", "## Thuis", "- [ ] Afwas"].join("\n"),
	);
	const after = tree(
		["## Werk", "## Thuis", "- [ ] Afwas", "- [ ] Bellen"].join("\n"),
	);

	it("keeps its seen-mark, with no hint needed", () => {
		// The words did not change, so the pair (note, text) still finds it.
		const seen = [idOf(before, "Bellen")];
		expect(labelsSeen(after, carrySeen(before, after, seen))).toEqual(["Bellen"]);
	});
});

describe("a whole section that moved", () => {
	const before = tree(
		[
			"## Project",
			"### Deeltaken",
			"- [ ] Een",
			"- [ ] Twee",
			"## Andere",
		].join("\n"),
	);
	const after = tree(
		[
			"## Project",
			"## Andere",
			"### Deeltaken",
			"- [ ] Een",
			"- [ ] Twee",
		].join("\n"),
	);

	it("carries the marks of everything that travelled with it", () => {
		// Every task under a moved heading gets a new id, because the heading
		// path is part of it. Losing the lot would take a visible bite out of a
		// round for a move the reader made on purpose.
		const seen = [idOf(before, "Een"), idOf(before, "Twee")];
		expect(labelsSeen(after, carrySeen(before, after, seen))).toEqual([
			"Een",
			"Twee",
		]);
	});

	it("carries the mark on the heading itself too", () => {
		const heading = [...before.byId].find(
			([, node]) => node.label === "Deeltaken",
		);
		const seen = [heading?.[0] ?? ""];
		expect(labelsSeen(after, carrySeen(before, after, seen))).toEqual([
			"Deeltaken",
		]);
	});
});

describe("what it refuses to guess", () => {
	it("pairs duplicates one for one, keeping the count right", () => {
		// Two tasks with the same words, one of them seen. Which of the two comes
		// out seen is arbitrary; that exactly one does is not.
		const before = tree(["## Werk", "- [ ] Bellen", "- [ ] Bellen"].join("\n"));
		const after = tree(
			["## Werk", "- [ ] Bellen", "- [ ] Bellen", "- [ ] Mailen"].join("\n"),
		);

		const one = [...before.byId]
			.filter(([, node]) => node.label === "Bellen")
			.map(([id]) => id)[0];

		expect(carrySeen(before, after, [one])).toHaveLength(1);
	});

	it("keeps an id it does not recognise rather than dropping it", () => {
		// It may belong to a note this edit never touched. What is genuinely gone
		// is pruned elsewhere, against the tree that is on the disc.
		const before = tree("## Werk\n- [ ] Bellen");
		const after = tree("## Werk\n- [ ] Bellen");
		expect(carrySeen(before, after, ["iets-van-een-andere-notitie"])).toEqual([
			"iets-van-een-andere-notitie",
		]);
	});

	it("does nothing at all when the edit changed nothing", () => {
		const before = tree("## Werk\n- [ ] Bellen\n- [ ] Mailen");
		const after = tree("## Werk\n- [ ] Bellen\n- [ ] Mailen");
		const seen = [idOf(before, "Bellen")];
		expect(carrySeen(before, after, seen)).toEqual(seen);
	});
});

describe("landAfter — where the wheel lands once an action is written", () => {
	const on = new Set(["task-a", "task-b"]);
	const has = (id: string): boolean => on.has(id);

	it("goes to the item the action was aimed past", () => {
		expect(landAfter("task-b", "task-a", has)).toBe("task-b");
	});

	it("falls back when that item is gone too", () => {
		// A filter, or a second edit: the aim is a hope, not a promise.
		expect(landAfter("task-z", "task-a", has)).toBe("task-a");
	});

	it("carries the old wedge across when nothing was aimed at", () => {
		expect(landAfter(null, "task-a", has)).toBe("task-a");
	});

	it("has nothing to offer when neither is there", () => {
		expect(landAfter("task-z", null, has)).toBeNull();
		expect(landAfter(null, null, has)).toBeNull();
	});
});
