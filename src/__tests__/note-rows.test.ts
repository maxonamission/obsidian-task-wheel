import { describe, expect, it } from "vitest";
import { prepareFuzzySearch, type SearchResult, TFile } from "obsidian";
import { noteRows } from "../view/note-picker";

/**
 * The rows in the carry picker (BC_E3_S31, regressie 21 aug 2026).
 *
 * The picker went slow or blank the moment anything was typed, and nothing here
 * caught it: the list-building lived inside the modal, so the only thing under
 * test was the vault half. This is the other half — which notes come back, in
 * what order, and whether the offer to make a new one is there — with the
 * matcher handed in so it can be measured without a workspace.
 */

const note = (path: string, mtime = 0): TFile => {
	const one = new TFile();
	one.path = path;
	one.basename = (path.split("/").pop() ?? path).replace(/\.md$/, "");
	one.stat = { mtime, ctime: 0, size: 0 };
	return one;
};

/** Newest first, the way the picker holds them. */
const vault = [
	note("Werk/Plan.md", 3),
	note("Werk/Archief/Plannen.md", 2),
	note("Thuis/Klussen.md", 1),
];

const scorer = (query: string) => {
	const search = prepareFuzzySearch(query);
	return (text: string): SearchResult | null => search(text);
};

const nothingThere = (): boolean => false;

describe("noteRows — what the carry picker offers", () => {
	it("shows the recently touched notes before anything is typed", () => {
		const rows = noteRows(vault, "", scorer(""), nothingThere);

		expect(rows.map((row) => row.kind === "existing" && row.file.path)).toEqual([
			"Werk/Plan.md",
			"Werk/Archief/Plannen.md",
			"Thuis/Klussen.md",
		]);
	});

	it("offers nothing to make while the box is still empty", () => {
		// An offer to make `.md` is not an offer; `newNotePath` refuses it and no
		// row appears, which is why the list used to fill fine until you typed.
		expect(noteRows(vault, "", scorer(""), nothingThere)).toHaveLength(3);
		expect(noteRows(vault, "   ", scorer(""), nothingThere)).toHaveLength(3);
	});

	it("narrows to what was typed, matching on the whole path", () => {
		const rows = noteRows(vault, "Werk/", scorer("Werk/"), nothingThere);
		const found = rows.filter((row) => row.kind === "existing");

		expect(found.map((row) => row.kind === "existing" && row.file.path)).toEqual(
			["Werk/Plan.md", "Werk/Archief/Plannen.md"],
		);
	});

	it("keeps every row a row — never a file with nothing in it", () => {
		// The regression in one line: the offer travelled as an empty `TFile`, so
		// a row that was not a note still looked like one.
		for (const row of noteRows(vault, "Nieuw", scorer("Nieuw"), nothingThere)) {
			if (row.kind === "existing") expect(row.file).toBeInstanceOf(TFile);
			else expect(row).not.toBeInstanceOf(TFile);
		}
	});

	it("puts the offer to make one underneath the notes that exist", () => {
		const rows = noteRows(vault, "Plan", scorer("Plan"), nothingThere);
		const last = rows[rows.length - 1];

		expect(rows.length).toBeGreaterThan(1);
		expect(last).toEqual({
			kind: "new",
			path: "Plan.md",
			folders: [],
		});
	});

	it("names the folders that would be made along with it", () => {
		const rows = noteRows(
			vault,
			"Archief/2026/Klussen",
			scorer("Archief/2026/Klussen"),
			nothingThere,
		);

		expect(rows[rows.length - 1]).toEqual({
			kind: "new",
			path: "Archief/2026/Klussen.md",
			folders: ["Archief", "Archief/2026"],
		});
	});

	it("leaves the offer out when that note is already there", () => {
		const rows = noteRows(
			vault,
			"Werk/Plan",
			scorer("Werk/Plan"),
			(path) => path === "Werk/Plan.md",
		);

		expect(rows.every((row) => row.kind === "existing")).toBe(true);
	});

	it("leaves it out when nothing typable could be made", () => {
		const rows = noteRows(vault, "Wat?", scorer("Wat?"), nothingThere);

		expect(rows.some((row) => row.kind === "new")).toBe(false);
	});

	it("stops at the row limit, and still offers to make one", () => {
		const many = Array.from({ length: 200 }, (_, at) =>
			note(`Werk/Item ${at}.md`, 200 - at),
		);

		const rows = noteRows(many, "Werk", scorer("Werk"), nothingThere, 50);

		expect(rows.filter((row) => row.kind === "existing")).toHaveLength(50);
		expect(rows[rows.length - 1]?.kind).toBe("new");
	});
});
