import { describe, expect, it } from "vitest";
import { prepareFuzzySearch, type SearchResult } from "obsidian";
import { type PathRow, pathRows } from "../view/path-suggest";

/**
 * What the box that says what a wheel is about offers (BC_E3_S36).
 *
 * The suggester itself is Obsidian's `AbstractInputSuggest` and needs a real
 * input to hang on. This is the half that decides *which* rows and in *what*
 * order — the half that can be wrong without anybody noticing.
 */

const vault: PathRow[] = [
	{ kind: "folder", path: "Werk" },
	{ kind: "folder", path: "Werk/Klanten" },
	{ kind: "folder", path: "Gezin" },
	{ kind: "note", path: "Werk/Plan.md" },
	{ kind: "note", path: "Werk/Klanten/KNSB.md" },
	{ kind: "note", path: "Gezin/Weekend.md" },
];

const scorer = (query: string) => {
	const search = prepareFuzzySearch(query);
	return (text: string): SearchResult | null => search(text);
};

describe("pathRows — folders and notes in one box", () => {
	it("puts the folders first while nothing is typed", () => {
		// A folder is the wider answer and there are far fewer of them: a list of
		// folders can be read, a list of every note can only be scrolled.
		const rows = pathRows(vault, "", scorer(""));

		expect(rows.slice(0, 3).every((row) => row.kind === "folder")).toBe(true);
		expect(rows).toHaveLength(6);
	});

	it("offers folders and notes together once something is typed", () => {
		const rows = pathRows(vault, "Klanten", scorer("Klanten"));

		expect(rows.map((row) => row.path)).toEqual([
			"Werk/Klanten",
			"Werk/Klanten/KNSB.md",
		]);
	});

	it("matches on the whole path, so a folder name finds what is in it", () => {
		const rows = pathRows(vault, "Gezin", scorer("Gezin"));

		expect(rows.map((row) => row.path)).toEqual(["Gezin", "Gezin/Weekend.md"]);
	});

	it("gives a tie to the folder", () => {
		const tied: PathRow[] = [
			{ kind: "note", path: "Plan.md" },
			{ kind: "folder", path: "Plan" },
		];

		expect(pathRows(tied, "Plan", scorer("Plan"))[0]).toEqual({
			kind: "folder",
			path: "Plan",
		});
	});

	it("offers nothing when nothing matches, rather than everything", () => {
		expect(pathRows(vault, "zzz", scorer("zzz"))).toEqual([]);
	});

	it("stops at the row limit", () => {
		const many: PathRow[] = Array.from({ length: 100 }, (_, at) => ({
			kind: "note",
			path: `Werk/Item ${at}.md`,
		}));

		expect(pathRows(many, "Werk", scorer("Werk"), 30)).toHaveLength(30);
		expect(pathRows(many, "", scorer(""), 30)).toHaveLength(30);
	});
});
