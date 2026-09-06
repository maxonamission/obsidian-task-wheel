import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Carrying a branch while a filter runs, end to end.
 *
 * The unit tests on `whatTravels` passed and the owner still saw the whole
 * branch land in the other note (18 aug 2026). So the fault was in a seam, and
 * finding it meant running the seam: pick a note, pick a destination, write both
 * files, then read what actually arrived.
 *
 * The two pickers are the only things standing in for a person here. Everything
 * else is the shipped code.
 */

const picked = { note: "", where: null as unknown };

vi.mock("../view/note-picker", () => ({
	pickNote: () => {
		const file = vault.getAbstractFileByPath(picked.note);
		return Promise.resolve(file === null ? null : { kind: "existing", file });
	},
	// The real one only makes a note when the choice asks for it, and no case
	// here asks — so this stands in for the half that is not being tested.
	noteFor: (_app: unknown, choice: { kind: string; file?: unknown }) =>
		Promise.resolve(choice.kind === "existing" ? choice.file : null),
}));

vi.mock("../view/heading-picker", () => ({
	pickDestination: () => Promise.resolve({ shown: true, choice: picked.where }),
	pickHeading: () => Promise.resolve(null),
}));

import { TFile } from "obsidian";
import { layoutWheel } from "../layout/radial";
import {
	type CarryPreset,
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	type ParseOptions,
	VAULT_SCOPE,
	type WheelScope,
} from "../model/types";
import { buildTree } from "../parse/build-tree";
import { DEFAULT_SETTINGS, parseOptionsOf, setFilter } from "../settings";
import { carryTo, carryToPreset } from "../view/carry-flow";

/** A vault of plain strings, with just the surface `writeback` touches. */
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

/** Long enough for two reads, two pickers and two writes to have happened. */
const settle = async (): Promise<void> => {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};

const finished: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	filter: { ...NO_FILTER, status: "finished" },
};

/** The filter as the plugin itself assembles it, per blikveld (BC_E3_S16). */
const throughSettings = (scope: WheelScope): ParseOptions => {
	const settings = structuredClone(DEFAULT_SETTINGS);
	setFilter(settings, scope, { ...NO_FILTER, status: "finished" });
	return parseOptionsOf(settings, scope);
};

/** Carry the node the wheel labels `label`. */
async function carry(label: string, options: ParseOptions): Promise<void> {
	const tree = buildTree(
		[...notes].map(([path, content]) => ({ path, content })),
		options,
	);
	const layout = layoutWheel(tree);
	const laid = layout.nodes.find((node) => node.node.label === label);
	if (laid === undefined) throw new Error(`no node called ${label}`);

	carryTo(
		{
			app,
			options: () => options,
			trace: () => undefined,
			refresh: () => Promise.resolve(),
			refreshCarrying: () => Promise.resolve(),
		},
		laid,
		"move",
	);
	await settle();
}

/** Carry the node the wheel labels `label` to a named destination. */
async function carryPreset(
	label: string,
	options: ParseOptions,
	preset: CarryPreset,
): Promise<void> {
	const tree = buildTree(
		[...notes].map(([path, content]) => ({ path, content })),
		options,
	);
	const layout = layoutWheel(tree);
	const laid = layout.nodes.find((node) => node.node.label === label);
	if (laid === undefined) throw new Error(`no node called ${label}`);

	carryToPreset(
		{
			app,
			options: () => options,
			trace: () => undefined,
			refresh: () => Promise.resolve(),
			refreshCarrying: () => Promise.resolve(),
		},
		laid,
		preset,
	);
	await settle();
}

const landed = (): string => notes.get("Archief.md") ?? "";
const left = (): string => notes.get("Klussen.md") ?? "";

beforeEach(() => {
	notes.clear();
	picked.note = "Archief.md";
	picked.where = { kind: "keep" };
	notes.set("Archief.md", "# Archief\n");
});

describe("carrying a branch while the filter shows only finished work", () => {
	it("sends the finished tasks and leaves the open ones behind", async () => {
		notes.set(
			"Klussen.md",
			[
				"## Tuin",
				"- [x] Haag snoeien",
				"- [ ] Terras vegen",
				"- [x] Bladeren harken",
				"",
			].join("\n"),
		);

		await carry("Tuin", finished);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).toContain("Bladeren harken");
		expect(landed()).not.toContain("Terras vegen");

		expect(left()).toContain("Terras vegen");
		expect(left()).not.toContain("Haag snoeien");
	});

	it("keeps a subsection's finished work under that subsection", async () => {
		notes.set(
			"Klussen.md",
			[
				"## Klussen",
				"### Tuin",
				"- [x] Haag snoeien",
				"- [ ] Terras vegen",
				"### Binnen",
				"- [x] Lamp vervangen",
				"",
			].join("\n"),
		);

		await carry("Klussen", finished);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).toContain("Lamp vervangen");
		expect(landed()).not.toContain("Terras vegen");
	});

	/**
	 * The regression of 18 aug 2026.
	 *
	 * An open parent is not in the round. The wheel draws it only as a
	 * **carrier**, so the finished work under it can be reached — and carrying a
	 * carrier used to carry everything, open children included.
	 */
	it("never carries a carrier — only what the round shows under it", async () => {
		notes.set(
			"Klussen.md",
			[
				"## Tuin",
				"- [ ] Haag aanpakken",
				"    - [x] Snoeien",
				"    - [ ] Afvoeren",
				"",
			].join("\n"),
		);

		await carry("Haag aanpakken", finished);

		expect(landed()).toContain("Snoeien");
		expect(landed()).not.toContain("Haag aanpakken");
		expect(landed()).not.toContain("Afvoeren");

		expect(left()).toContain("Haag aanpakken");
		expect(left()).toContain("Afvoeren");
		expect(left()).not.toContain("Snoeien");
	});

	it("carries a task that is in the round whole — a block is indivisible", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag aanpakken", "    - [ ] Afvoeren", ""].join("\n"),
		);

		await carry("Haag aanpakken", finished);

		expect(landed()).toContain("Haag aanpakken");
		expect(landed()).toContain("Afvoeren");
	});

	it("carries a note the same way it carries a heading", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carry("Klussen", finished);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).not.toContain("Terras vegen");
	});

	it("does the same with headings-as-groups switched off", async () => {
		notes.set(
			"Klussen.md",
			["- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carry("Klussen", { ...finished, useHeadingsAsGroups: false });

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).not.toContain("Terras vegen");
	});

	it("leaves the open work behind on the vault wheel", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carry("Tuin", throughSettings(VAULT_SCOPE));

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).not.toContain("Terras vegen");
	});

	it("leaves the open work behind on a wheel over one note", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carry("Tuin", throughSettings({ kind: "note", path: "Klussen.md" }));

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).not.toContain("Terras vegen");
	});

	it("sends the whole branch when no filter is on", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carry("Tuin", DEFAULT_PARSE_OPTIONS);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).toContain("Terras vegen");
	});
});

describe("carrying while the filter names a heading (BC_E3_S147)", () => {
	/**
	 * `inRound` dropped the heading path on its way to `matches`, so the `under`
	 * rule failed for every task there while passing in `build-tree`. The wheel
	 * showed the branch and the carry said "nothing to carry" about it — the
	 * same broken promise as carrying too much, running the other way (found by
	 * audit, 6 sep 2026).
	 */
	const underTuin: ParseOptions = {
		...DEFAULT_PARSE_OPTIONS,
		filter: { ...NO_FILTER, heading: "Tuin" },
	};

	it("carries the work the wheel is showing under that heading", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [ ] Terras vegen", "- [ ] Haag snoeien", ""].join("\n"),
		);

		await carry("Tuin", underTuin);

		expect(landed()).toContain("Terras vegen");
		expect(landed()).toContain("Haag snoeien");
		expect(left()).not.toContain("Terras vegen");
	});

	it("still leaves behind what the heading rule sets aside", async () => {
		notes.set(
			"Klussen.md",
			[
				"## Tuin",
				"- [ ] Terras vegen",
				"## Zolder",
				"- [ ] Dozen sorteren",
				"",
			].join("\n"),
		);

		await carry("Tuin", underTuin);

		expect(landed()).toContain("Terras vegen");
		expect(landed()).not.toContain("Dozen sorteren");
		expect(left()).toContain("Dozen sorteren");
	});
});

describe("a named destination (BC_E3_S18)", () => {
	const later: CarryPreset = {
		name: "LaterMaybe",
		notePath: "Archief.md",
		headingPath: ["Ooit"],
		how: "move",
	};

	it("writes without asking anything, under the heading it names", async () => {
		notes.set("Klussen.md", ["- [ ] Haag snoeien", ""].join("\n"));

		await carryPreset("Haag snoeien", DEFAULT_PARSE_OPTIONS, later);

		expect(landed()).toContain("## Ooit");
		expect(landed()).toContain("Haag snoeien");
		expect(left()).not.toContain("Haag snoeien");
	});

	it("copies instead of moves when that is what it was made for", async () => {
		notes.set("Klussen.md", ["- [ ] Haag snoeien", ""].join("\n"));

		await carryPreset("Haag snoeien", DEFAULT_PARSE_OPTIONS, {
			...later,
			how: "copy",
		});

		expect(landed()).toContain("Haag snoeien");
		expect(left()).toContain("Haag snoeien");
	});

	it("carries the round's share, exactly as the two-picker route does", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [x] Haag snoeien", "- [ ] Terras vegen", ""].join("\n"),
		);

		await carryPreset("Tuin", finished, later);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).not.toContain("Terras vegen");
	});

	it("says so and writes nothing when the note it names is gone", async () => {
		notes.set("Klussen.md", ["- [ ] Haag snoeien", ""].join("\n"));

		await carryPreset("Haag snoeien", DEFAULT_PARSE_OPTIONS, {
			...later,
			notePath: "Weg.md",
		});

		// Nothing written anywhere, and the item stayed put.
		expect(notes.has("Weg.md")).toBe(false);
		expect(left()).toContain("Haag snoeien");
		expect(landed()).toBe("# Archief\n");
	});
});

/**
 * Carrying a whole note (BC_E3_S22).
 *
 * A note is not a block, so lifting one from its first line meant carrying a
 * different thing in every note shape. Measured 18 aug 2026, and the worst of
 * the four was silent: a note beginning with `## Tuin` carried only that
 * section and said it had moved things.
 */
describe("carrying a whole note", () => {
	const shapes: Record<string, string[]> = {
		"begins with a heading": [
			"## Tuin",
			"- [ ] Haag snoeien",
			"## Binnen",
			"- [ ] Lamp vervangen",
		],
		"begins with a task": ["- [ ] Haag snoeien", "- [ ] Lamp vervangen"],
		"begins with prose": [
			"Wat inleiding.",
			"",
			"- [ ] Haag snoeien",
			"- [ ] Lamp vervangen",
		],
		"begins with front matter": [
			"---",
			"tags: [huis]",
			"---",
			"",
			"- [ ] Haag snoeien",
			"- [ ] Lamp vervangen",
		],
		"begins with a blank line": [
			"",
			"- [ ] Haag snoeien",
			"- [ ] Lamp vervangen",
		],
		"has an H1 title": [
			"# Klussen",
			"## Tuin",
			"- [ ] Haag snoeien",
			"## Binnen",
			"- [ ] Lamp vervangen",
		],
	};

	for (const [shape, lines] of Object.entries(shapes)) {
		it(`takes every task when the note ${shape}`, async () => {
			notes.set("Klussen.md", [...lines, ""].join("\n"));

			await carry("Klussen", DEFAULT_PARSE_OPTIONS);

			expect(landed()).toContain("Haag snoeien");
			expect(landed()).toContain("Lamp vervangen");
			expect(left()).not.toContain("Haag snoeien");
			expect(left()).not.toContain("Lamp vervangen");
		});
	}

	it("brings each task's heading along, so the structure arrives too", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [ ] Haag snoeien", "## Binnen", "- [ ] Lamp vervangen", ""].join("\n"),
		);
		picked.where = null;
		picked.where = { kind: "keep" };

		await carry("Klussen", DEFAULT_PARSE_OPTIONS);

		expect(landed()).toContain("## Tuin");
		expect(landed()).toContain("## Binnen");
		const tuin = landed().indexOf("Tuin");
		const haag = landed().indexOf("Haag snoeien");
		const binnen = landed().indexOf("Binnen");
		expect(tuin).toBeLessThan(haag);
		expect(haag).toBeLessThan(binnen);
	});

	it("leaves the headings themselves where they are", async () => {
		notes.set(
			"Klussen.md",
			["## Tuin", "- [ ] Haag snoeien", "Wat proza dat het wiel nooit zag.", ""].join("\n"),
		);

		await carry("Klussen", DEFAULT_PARSE_OPTIONS);

		// A heading may carry prose the wheel never saw, and a note emptied of
		// tasks is still a note.
		expect(left()).toContain("## Tuin");
		expect(left()).toContain("Wat proza dat het wiel nooit zag.");
	});

	it("takes only the round's share when a filter runs", async () => {
		notes.set(
			"Klussen.md",
			[
				"## Tuin",
				"- [x] Haag snoeien",
				"- [ ] Terras vegen",
				"## Binnen",
				"- [x] Lamp vervangen",
				"",
			].join("\n"),
		);

		await carry("Klussen", finished);

		expect(landed()).toContain("Haag snoeien");
		expect(landed()).toContain("Lamp vervangen");
		expect(landed()).not.toContain("Terras vegen");
		expect(left()).toContain("Terras vegen");
	});
});
