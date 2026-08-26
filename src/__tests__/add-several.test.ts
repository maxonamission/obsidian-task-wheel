import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adding several tasks in one opening of the box, end to end (BC_E3_S24).
 *
 * The interesting part is not the box; it is what the notes look like
 * afterwards. Two routes write tasks — beside a task, and at the end of a
 * heading — and they place them in completely different ways, so both are run
 * here against a real note.
 *
 * The box itself is the only thing standing in for a person.
 */

/** What the reader "types", and what the box was told to call itself. */
const typed = { lines: [] as string[], title: "" };

vi.mock("../view/prompt", async () => ({
	...(await vi.importActual<typeof import("../view/prompt")>("../view/prompt")),
	promptForTasks: async (
		_app: unknown,
		title: string,
		write: (text: string) => Promise<boolean>,
	): Promise<number> => {
		typed.title = title;
		let written = 0;
		for (const line of typed.lines) {
			// Exactly what the modal does: stop the moment a write says no.
			if (!(await write(line))) break;
			written++;
		}
		return written;
	},
	promptForText: () => Promise.resolve(null),
}));

import { TFile } from "obsidian";
import { layoutWheel } from "../layout/radial";
import { DEFAULT_PARSE_OPTIONS } from "../model/types";
import { buildTree } from "../parse/build-tree";
import { insertTask } from "../parse/outline-edit";
import { pressMeans } from "../view/prompt";
import { addToSection, type SectionHost } from "../view/section-edits";
import { writeInsertAfter } from "../vault/writeback";

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

/** The node the wheel draws for `label`, in a wheel over these notes. */
function nodeFor(label: string) {
	const tree = buildTree(
		[...notes].map(([path, content]) => ({ path, content })),
		DEFAULT_PARSE_OPTIONS,
	);
	const layout = layoutWheel(tree);
	const laid = layout.nodes.find((one) => one.node.label === label);
	if (laid === undefined) throw new Error(`no node labelled ${label}`);
	return laid;
}

beforeEach(() => {
	notes.clear();
	typed.lines = [];
	typed.title = "";
});

describe("adding beside a task, several in a row", () => {
	/** The walk the view does: each write says where the next one goes. */
	async function addBeside(
		line: number,
		texts: string[],
		asChild = false,
	): Promise<number> {
		let at = { path: NOTE, line, raw: linesOf()[line] ?? "" };
		let child = asChild;
		let written = 0;

		for (const text of texts) {
			const { outcome, at: landed } = await writeInsertAfter(
				app,
				at,
				text,
				child,
			);
			if (outcome !== "written" || landed === null) break;
			at = landed;
			child = false;
			written++;
		}
		return written;
	}

	it("puts them in the order they were typed", async () => {
		notes.set(NOTE, ["- [ ] Inpakken", "- [ ] Iets anders"].join("\n"));

		expect(await addBeside(0, ["Een", "Twee", "Drie"])).toBe(3);
		expect(linesOf()).toEqual([
			"- [ ] Inpakken",
			"- [ ] Een",
			"- [ ] Twee",
			"- [ ] Drie",
			"- [ ] Iets anders",
		]);
	});

	it("would have reversed them without walking the reference along", async () => {
		// The defect this guards, spelled out: a task goes in after the whole
		// block of the line it is given, so handing the same line in three times
		// stacks them backwards.
		let lines = ["- [ ] Inpakken", "- [ ] Iets anders"];
		for (const text of ["Een", "Twee", "Drie"]) {
			lines = insertTask(lines, 0, text, false)?.lines ?? lines;
		}

		expect(lines.slice(1, 4)).toEqual([
			"- [ ] Drie",
			"- [ ] Twee",
			"- [ ] Een",
		]);
	});

	it("makes the second a sibling of the first, not a grandchild", async () => {
		notes.set(NOTE, ["- [ ] Inpakken"].join("\n"));

		await addBeside(0, ["Tas", "Paspoort"], true);

		expect(linesOf()).toEqual([
			"- [ ] Inpakken",
			"    - [ ] Tas",
			"    - [ ] Paspoort",
		]);
	});

	it("keeps whatever a task carries after it", async () => {
		notes.set(
			NOTE,
			["- [ ] Inpakken 📅 2026-08-20 ⏫", "    - [ ] Tas"].join("\n"),
		);

		await addBeside(0, ["Paspoort"]);

		expect(linesOf()[2]).toBe("- [ ] Paspoort");
		expect(linesOf()[0]).toBe("- [ ] Inpakken 📅 2026-08-20 ⏫");
	});

	it("stops as soon as the note has moved under it", async () => {
		notes.set(NOTE, ["- [ ] Inpakken"].join("\n"));

		const stale = { path: NOTE, line: 0, raw: "- [ ] Iets heel anders" };
		const { outcome, at } = await writeInsertAfter(app, stale, "Een", false);

		expect(outcome).toBe("stale");
		expect(at).toBeNull();
		expect(linesOf()).toEqual(["- [ ] Inpakken"]);
	});
});

describe("adding at the end of a heading, several in a row", () => {
	const host = (): SectionHost => ({
		app,
		trace: () => undefined,
		refresh: () => {
			refreshes++;
			return Promise.resolve();
		},
		refreshCarrying: () => {
			refreshes++;
			return Promise.resolve();
		},
	});

	let refreshes = 0;

	beforeEach(() => {
		refreshes = 0;
		notes.set(
			NOTE,
			["## Reis", "- [ ] Inpakken", "## Thuis", "- [ ] Afwassen"].join("\n"),
		);
	});

	it("appends them in the order they were typed", async () => {
		typed.lines = ["Tickets", "Verzekering"];

		await addToSection(host(), nodeFor("Reis"));

		expect(linesOf()).toEqual([
			"## Reis",
			"- [ ] Inpakken",
			"- [ ] Tickets",
			"- [ ] Verzekering",
			"## Thuis",
			"- [ ] Afwassen",
		]);
	});

	it("redraws once, however many were typed", async () => {
		typed.lines = ["Een", "Twee", "Drie", "Vier"];

		await addToSection(host(), nodeFor("Reis"));

		expect(refreshes).toBe(1);
	});

	it("does not redraw at all when nothing was typed", async () => {
		typed.lines = [];

		await addToSection(host(), nodeFor("Reis"));

		expect(refreshes).toBe(0);
		expect(linesOf()).toHaveLength(4);
	});

	it("leaves the next section alone", async () => {
		typed.lines = ["Tickets"];

		await addToSection(host(), nodeFor("Reis"));

		expect(linesOf().slice(-2)).toEqual(["## Thuis", "- [ ] Afwassen"]);
	});
});

describe("pressMeans — what a press on the box means", () => {
	it("writes and closes on the finishing press", () => {
		expect(pressMeans("Bellen", true)).toBe("write and close");
	});

	it("writes and hands back an empty field on the other one", () => {
		expect(pressMeans("Bellen", false)).toBe("write and clear");
	});

	it("closes on an empty finishing press, writing nothing", () => {
		expect(pressMeans("   ", true)).toBe("close");
	});

	it("does nothing at all on an empty “add another”", () => {
		// A slip, not an instruction. The box stays open with the field as it is.
		expect(pressMeans("", false)).toBe("nothing");
	});
});
