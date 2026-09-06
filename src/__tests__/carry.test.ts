import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { moveToSection } from "../parse/outline-edit";
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

	it("keeps it through the write that actually does the move", () => {
		// The same claim, but measured against `moveToSection` rather than two
		// trees typed out by hand — the second tree is where a wrong assumption
		// hides (eigenaar, 4 sep 2026: does a heading move lose the mark?).
		const lines = ["## Een", "- [ ] Bellen", "- [ ] Mailen", "## Twee"];
		const moved = moveToSection(lines, 1, 3);
		if (moved === null) throw new Error("the move did not happen");

		const from = tree(lines.join("\n"));
		const to = tree(moved.join("\n"));

		expect(carrySeen(from, to, [idOf(from, "Bellen")])).toEqual([
			idOf(to, "Bellen"),
		]);
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

/* ------------------------------------------------------------------ */
/* A task carried to another note (BC_E3_S137)                         */
/* ------------------------------------------------------------------ */

/** Two notes on one wheel, which is what a carry needs to be visible at all. */
function vault(notes: Record<string, string>): WheelTree {
	const input: NoteInput[] = Object.entries(notes).map(([path, content]) => ({
		path,
		content,
	}));
	return buildTree(input, DEFAULT_PARSE_OPTIONS);
}

/** The id of the task with these words in this note. */
function idIn(of: WheelTree, path: string, label: string): string {
	for (const [id, node] of of.byId) {
		if (node.kind === "task" && node.label === label && node.source?.path === path) {
			return id;
		}
	}
	throw new Error(`no task called ${label} in ${path}`);
}

describe("a task carried to another note", () => {
	const before = vault({
		"Werk/Nu.md": "- [ ] Bellen\n- [ ] Mailen",
		"Werk/Later.md": "# Later",
	});
	const after = vault({
		"Werk/Nu.md": "- [ ] Mailen",
		"Werk/Later.md": "# Later\n- [ ] Bellen",
	});
	// "Bellen" stood on line 0 of Nu.md and left; the range says so.
	const moved = {
		from: "Werk/Nu.md",
		to: "Werk/Later.md",
		lines: [{ start: 0, end: 1 }],
	};

	it("takes its seen-mark with it", () => {
		// Without the hint the task is met a second time in the same round, in the
		// wedge you moved it to — the one action the wheel is most used for.
		const seen = [idIn(before, "Werk/Nu.md", "Bellen")];
		const carried = carrySeen(before, after, seen, undefined, moved);
		expect(carried).toEqual([idIn(after, "Werk/Later.md", "Bellen")]);
	});

	it("loses the mark when nothing says it travelled", () => {
		// The same two trees, no hint: this is the defect, kept as a test so the
		// fix cannot quietly be undone.
		const seen = [idIn(before, "Werk/Nu.md", "Bellen")];
		expect(labelsSeen(after, carrySeen(before, after, seen))).toEqual([]);
	});

	it("keeps the reading wedge on it", () => {
		const was = idIn(before, "Werk/Nu.md", "Bellen");
		expect(carryFocus(before, after, was, undefined, moved)).toBe(
			idIn(after, "Werk/Later.md", "Bellen"),
		);
	});

	it("leaves what stayed behind alone", () => {
		const seen = [
			idIn(before, "Werk/Nu.md", "Bellen"),
			idIn(before, "Werk/Nu.md", "Mailen"),
		];
		expect(labelsSeen(after, carrySeen(before, after, seen, undefined, moved))).toEqual(
			["Bellen", "Mailen"],
		);
	});

	it("leaves the twin that stayed behind with its own mark", () => {
		// The case that broke when the hint named labels instead of lines
		// (BC_E3_S144): one of two identical tasks is carried away, and matching
		// on the words re-keyed both — so the twin nobody touched came back
		// unseen and the round went backwards.
		const from = vault({
			"Werk/Nu.md": "- [ ] Bellen\n- [ ] Bellen",
			"Werk/Later.md": "# Later",
		});
		const to = vault({
			"Werk/Nu.md": "- [ ] Bellen",
			"Werk/Later.md": "# Later\n- [ ] Bellen",
		});
		const seen = [...from.byId]
			.filter(([, node]) => node.kind === "task" && node.label === "Bellen")
			.map(([id]) => id);
		expect(seen).toHaveLength(2);

		const carried = carrySeen(from, to, seen, undefined, {
			from: "Werk/Nu.md",
			to: "Werk/Later.md",
			// Only the first of the two left.
			lines: [{ start: 0, end: 1 }],
		});

		expect(labelsSeen(to, carried)).toEqual(["Bellen", "Bellen"]);
	});

	it("does not take the note's own node along with a block from its first line", () => {
		// A node standing for a whole note sits on line 0 with no line of its own.
		// A task carried off line 0 must not drag the note with it.
		const from = vault({
			"Werk/Nu.md": "- [ ] Bellen",
			"Werk/Later.md": "# Later",
		});
		const to = vault({
			"Werk/Nu.md": "- [ ] Mailen",
			"Werk/Later.md": "# Later\n- [ ] Bellen",
		});
		const note = [...from.byId].find(
			([, node]) => node.kind === "project" && node.label === "Nu",
		);
		expect(note).toBeDefined();

		const carried = carrySeen(from, to, [note?.[0] as string], undefined, {
			from: "Werk/Nu.md",
			to: "Werk/Later.md",
			lines: [{ start: 0, end: 1 }],
		});

		expect(to.byId.get(carried[0])?.label).toBe("Nu");
	});

	it("does not touch a task with the same words in a note it never left", () => {
		// Only the note the carry came out of is remapped, so a namesake elsewhere
		// keeps its own mark and its own place.
		const from = vault({
			"Werk/Nu.md": "- [ ] Bellen",
			"Thuis/Lijst.md": "- [ ] Bellen",
			"Werk/Later.md": "# Later",
		});
		const to = vault({
			"Werk/Nu.md": "",
			"Thuis/Lijst.md": "- [ ] Bellen",
			"Werk/Later.md": "# Later\n- [ ] Bellen",
		});
		const seen = [idIn(from, "Thuis/Lijst.md", "Bellen")];
		expect(carrySeen(from, to, seen, undefined, moved)).toEqual([
			idIn(to, "Thuis/Lijst.md", "Bellen"),
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
