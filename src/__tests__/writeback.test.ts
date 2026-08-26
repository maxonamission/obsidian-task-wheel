import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { extractBlock } from "../parse/cross-note";
import {
	type CarryOutcome,
	type LineRef,
	togglesThroughTasks,
	writeCarry,
	writeDone,
	writeStatus,
} from "../vault/writeback";

/**
 * The orchestration in `vault/writeback.ts`, which had no tests at all
 * (BC_E3_S45, audit 23 aug 2026 T1).
 *
 * Everything this module decides *about text* lives in `parse/`, and that half
 * is well covered. What was not covered is the half that only exists here: the
 * order of the two writes in a carry, which outcome each ending maps to, and
 * the route through somebody else's plugin. Both bugs reported on 17 aug 2026
 * were in exactly that half — the reporting, not the text.
 *
 * The interesting case is `twice`: the work landed but the source could not be
 * emptied, so it is now in two places. Nothing but a fake vault can produce
 * that, which is why it went untested and why it is the first test here.
 */

const notes = new Map<string, string>();

const fileFor = (path: string): TFile => {
	const file = new TFile();
	file.path = path;
	file.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
	file.extension = "md";
	return file;
};

/** Runs after the *next* write to any file, once. Stands in for a sync. */
let meanwhile: (() => void) | null = null;

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

		// Obsidian serialises `process` per file, not across files. Something
		// else touching the *source* between the two writes of a carry is
		// therefore entirely possible, and is the whole reason for the order.
		const after = meanwhile;
		meanwhile = null;
		after?.();

		return Promise.resolve(next);
	},
};

/** The Tasks plugin, when a test wants one. `null` is "not installed". */
let tasksApi: { executeToggleTaskDoneCommand: (line: string, path: string) => unknown } | null =
	null;

const app = {
	vault,
	get plugins() {
		return { plugins: tasksApi === null ? {} : { "obsidian-tasks-plugin": { apiV1: tasksApi } } };
	},
} as never;

const SOURCE = "Werk/Plan.md";
const TARGET = "Werk/Later.md";

const linesOf = (path: string): string[] => (notes.get(path) ?? "").split("\n");

const write = (path: string, lines: string[]): void => {
	notes.set(path, lines.join("\n"));
};

/** The block at `line` of the source, as the carry flow works it out. */
const blockAt = (line: number, path = SOURCE) => {
	const lifted = extractBlock(linesOf(path), line);
	if (lifted === null) throw new Error(`no block at line ${line}`);
	return lifted;
};

const refAt = (line: number, path = SOURCE): LineRef => ({
	path,
	line,
	raw: linesOf(path)[line] ?? "",
});

beforeEach(() => {
	notes.clear();
	meanwhile = null;
	tasksApi = null;
});

/* ------------------------------------------------------------------ */
/* The two-file write                                                  */
/* ------------------------------------------------------------------ */

describe("carrying work to another note", () => {
	beforeEach(() => {
		write(SOURCE, ["## Deze week", "- [ ] Bellen", "- [ ] Blijft staan"]);
		write(TARGET, ["# Later", ""]);
	});

	const carry = (mode: "move" | "copy" = "move"): Promise<CarryOutcome> =>
		writeCarry(app, refAt(1), TARGET, mode, null, [blockAt(1)]);

	it("moves: the other note has it and the source does not", async () => {
		const outcome = await carry();

		expect(outcome.kind).toBe("moved");
		expect(linesOf(TARGET)).toContain("- [ ] Bellen");
		expect(linesOf(SOURCE)).not.toContain("- [ ] Bellen");
		expect(linesOf(SOURCE)).toContain("- [ ] Blijft staan");
	});

	it("copies: both notes have it", async () => {
		const outcome = await carry("copy");

		expect(outcome.kind).toBe("copied");
		expect(linesOf(TARGET)).toContain("- [ ] Bellen");
		expect(linesOf(SOURCE)).toContain("- [ ] Bellen");
	});

	it("reports how much travelled, and which headings it had to make", async () => {
		const outcome = await writeCarry(app, refAt(1), TARGET, "move", ["Nieuw"], [
			blockAt(1),
		]);

		expect(outcome).toMatchObject({
			kind: "moved",
			blocks: 1,
			lines: 1,
			created: ["Nieuw"],
		});
		expect(linesOf(TARGET)).toContain("## Nieuw");
	});

	it("says 'twice' when the source changed between the two writes", async () => {
		// The work lands, and *then* something else edits the source line — so
		// the tidy-up cannot happen and the task is now in two places.
		meanwhile = () => {
			write(SOURCE, ["## Deze week", "- [ ] Bellen, maar anders", "- [ ] Blijft staan"]);
		};

		const outcome = await carry();

		expect(outcome.kind).toBe("twice");
		// Not a loss, which is the point of the order: it is in both notes.
		expect(linesOf(TARGET)).toContain("- [ ] Bellen");
		expect(linesOf(SOURCE)).toContain("- [ ] Bellen, maar anders");
	});

	it("refuses before touching the other note when the source has moved on", async () => {
		const stale = [blockAt(1)];
		write(SOURCE, ["## Deze week", "- [ ] Iets heel anders"]);

		const outcome = await writeCarry(app, refAt(1), TARGET, "move", null, stale);

		expect(outcome).toEqual({ kind: "refused", why: "stale" });
		// The half that matters: nothing was written anywhere.
		expect(linesOf(TARGET)).toEqual(["# Later", ""]);
		expect(linesOf(SOURCE)).toEqual(["## Deze week", "- [ ] Iets heel anders"]);
	});

	it("refuses when either note is gone", async () => {
		const block = [blockAt(1)];

		expect(
			await writeCarry(app, refAt(1), "Werk/Weg.md", "move", null, block),
		).toEqual({ kind: "refused", why: "missing" });
		expect(
			await writeCarry(
				app,
				{ ...refAt(1), path: "Werk/Weg.md" },
				TARGET,
				"move",
				null,
				block,
			),
		).toEqual({ kind: "refused", why: "missing" });
	});

	it("refuses to carry a note into itself, or to carry nothing", async () => {
		expect(
			await writeCarry(app, refAt(1), SOURCE, "move", null, [blockAt(1)]),
		).toEqual({ kind: "refused", why: "nothing" });
		expect(await writeCarry(app, refAt(1), TARGET, "move", null, [])).toEqual({
			kind: "refused",
			why: "nothing",
		});
	});

	it("writes a shared heading once for several blocks", async () => {
		write(SOURCE, [
			"## Deze week",
			"- [ ] Een",
			"- [ ] Twee",
			"- [ ] Drie",
		]);

		const outcome = await writeCarry(
			app,
			refAt(1),
			TARGET,
			"move",
			["Ingekomen"],
			[blockAt(1), blockAt(2)],
		);

		expect(outcome).toMatchObject({ kind: "moved", blocks: 2, lines: 2 });
		// One heading, not one per block — the blocks are pasted in order and
		// the second finds what the first had to make.
		expect(linesOf(TARGET).filter((line) => line === "## Ingekomen")).toHaveLength(1);
		expect(linesOf(TARGET).join("\n")).toContain("- [ ] Een\n- [ ] Twee");
		expect(linesOf(SOURCE)).toEqual(["## Deze week", "- [ ] Drie"]);
	});

	it("takes a whole branch along, subtasks and all", async () => {
		write(SOURCE, [
			"- [ ] Bellen",
			"    - [ ] Nummer opzoeken",
			"    - [ ] Terugbelverzoek",
			"- [ ] Blijft staan",
		]);

		const outcome = await writeCarry(app, refAt(0), TARGET, "move", null, [
			blockAt(0),
		]);

		expect(outcome).toMatchObject({ kind: "moved", blocks: 1, lines: 3 });
		expect(linesOf(TARGET)).toContain("    - [ ] Nummer opzoeken");
		expect(linesOf(SOURCE)).toEqual(["- [ ] Blijft staan"]);
	});
});

/* ------------------------------------------------------------------ */
/* Somebody else's plugin                                              */
/* ------------------------------------------------------------------ */

describe("ticking a task off", () => {
	beforeEach(() => {
		write(SOURCE, ["- [ ] Bellen 🔁 every week", "- [ ] Blijft staan"]);
	});

	it("ticks the box itself when Tasks is not installed", async () => {
		expect(togglesThroughTasks(app)).toBe(false);

		expect(await writeDone(app, refAt(0))).toBe("written");
		expect(linesOf(SOURCE)[0]).toContain("- [x]");
		// The recurrence is left exactly as it was: rolling it over is Tasks'
		// own logic, and guessing at it is what this module refuses to do.
		expect(linesOf(SOURCE)[0]).toContain("🔁 every week");
		expect(linesOf(SOURCE)).toHaveLength(2);
	});

	it("lets Tasks answer with two lines, and writes both", async () => {
		tasksApi = {
			executeToggleTaskDoneCommand: () =>
				"- [x] Bellen 🔁 every week ✅ 2026-08-23\n- [ ] Bellen 🔁 every week 📅 2026-08-30",
		};

		expect(togglesThroughTasks(app)).toBe(true);
		expect(await writeDone(app, refAt(0))).toBe("written");

		expect(linesOf(SOURCE)).toEqual([
			"- [x] Bellen 🔁 every week ✅ 2026-08-23",
			"- [ ] Bellen 🔁 every week 📅 2026-08-30",
			"- [ ] Blijft staan",
		]);
	});

	it("ticks the box itself when Tasks throws", async () => {
		const complained = vi.spyOn(console, "error").mockImplementation(() => undefined);
		tasksApi = {
			executeToggleTaskDoneCommand: () => {
				throw new Error("the shape changed under us");
			},
		};

		expect(await writeDone(app, refAt(0))).toBe("written");
		expect(linesOf(SOURCE)[0]).toContain("- [x]");
		// Loud in the console, but never in the way of the review action.
		expect(complained).toHaveBeenCalled();
		complained.mockRestore();
	});

	it("ticks the box itself when Tasks answers with nothing usable", async () => {
		tasksApi = { executeToggleTaskDoneCommand: () => "" };
		expect(await writeDone(app, refAt(0))).toBe("written");
		expect(linesOf(SOURCE)[0]).toContain("- [x]");

		write(SOURCE, ["- [ ] Bellen 🔁 every week", "- [ ] Blijft staan"]);
		tasksApi = { executeToggleTaskDoneCommand: () => 42 };
		expect(await writeDone(app, refAt(0))).toBe("written");
		expect(linesOf(SOURCE)[0]).toContain("- [x]");
	});

	it("says 'unchanged' when Tasks hands back the same line", async () => {
		tasksApi = {
			executeToggleTaskDoneCommand: (line: string) => line,
		};

		expect(await writeDone(app, refAt(0))).toBe("unchanged");
		expect(linesOf(SOURCE)[0]).toBe("- [ ] Bellen 🔁 every week");
	});

	it("keeps CRLF endings through the Tasks route", async () => {
		notes.set(SOURCE, "- [ ] Bellen\r\n- [ ] Blijft staan\r\n");
		tasksApi = { executeToggleTaskDoneCommand: () => "- [x] Bellen" };

		expect(
			await writeDone(app, { path: SOURCE, line: 0, raw: "- [ ] Bellen" }),
		).toBe("written");
		expect(notes.get(SOURCE)).toBe("- [x] Bellen\r\n- [ ] Blijft staan\r\n");
	});

	it("gives each of Tasks' two lines its own CRLF ending", async () => {
		// Where "one line in, one line out" and "one line in, several out" stop
		// being the same thing. On an LF note both produce the same bytes, so
		// only a CRLF note can tell them apart: the line ending has to go on
		// every line that comes back, not just at the end of the pair.
		notes.set(SOURCE, "- [ ] Bellen\r\n- [ ] Blijft staan\r\n");
		tasksApi = {
			executeToggleTaskDoneCommand: () => "- [x] Bellen ✅ 2026-08-23\n- [ ] Bellen 📅 2026-08-30",
		};

		expect(
			await writeDone(app, { path: SOURCE, line: 0, raw: "- [ ] Bellen" }),
		).toBe("written");
		expect(notes.get(SOURCE)).toBe(
			"- [x] Bellen ✅ 2026-08-23\r\n- [ ] Bellen 📅 2026-08-30\r\n- [ ] Blijft staan\r\n",
		);
	});
});

/* ------------------------------------------------------------------ */
/* What every write shares                                             */
/* ------------------------------------------------------------------ */

describe("what a write says when it does not happen", () => {
	beforeEach(() => {
		write(SOURCE, ["- [ ] Bellen"]);
	});

	it("says 'missing' for a note that is not there", async () => {
		expect(
			await writeStatus(app, { path: "Werk/Weg.md", line: 0, raw: "- [ ] X" }, "/"),
		).toBe("missing");
	});

	it("says 'stale' rather than writing over whatever is there now", async () => {
		expect(
			await writeStatus(app, { path: SOURCE, line: 0, raw: "- [ ] Iets anders" }, "/"),
		).toBe("stale");
		expect(linesOf(SOURCE)).toEqual(["- [ ] Bellen"]);
	});

	it("says 'unchanged' when the line already says it", async () => {
		expect(await writeStatus(app, refAt(0), " ")).toBe("unchanged");
	});
});
