import { beforeEach, describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { layoutWheel } from "../layout/radial";
import { DEFAULT_PARSE_OPTIONS } from "../model/types";
import { buildTree } from "../parse/build-tree";
import { headingsOf, outlineNote } from "../parse/outline";
import { BOM, linesOf } from "../parse/lines";
import { writeDone, writeMoveTo } from "../vault/writeback";

/**
 * A note that starts with a byte-order mark (BC_E3_S49, audit V4).
 *
 * Some editors and sync tools begin a UTF-8 file with an invisible `U+FEFF`. It
 * belongs to the encoding rather than to the first line, but every pattern the
 * parser uses anchors on `^`, so the mark sat *in* the first line and made it
 * unrecognisable: front matter was not skipped, the first heading was not a
 * heading, and a task on the first line was simply not on the wheel.
 *
 * That last one is the reason this is worth fixing rather than noting. A task
 * the wheel neither draws nor counts is exactly the lie hard requirement §3.1
 * rules out — and the reader has no way to notice, because the mark is
 * invisible in every editor that made it.
 *
 * This repo writes UTF-8 without a BOM. A reader's vault promises nothing.
 */

const notes = new Map<string, string>();

const fileFor = (path: string): TFile => {
	const file = new TFile();
	file.path = path;
	file.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
	file.extension = "md";
	return file;
};

const app = {
	vault: {
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
	},
} as never;

const NOTE = "Werk/Plan.md";

beforeEach(() => {
	notes.clear();
});

describe("reading a note that starts with a mark", () => {
	it("skips front matter that starts on the marked line", () => {
		const content = [
			`${BOM}---`,
			"type: project",
			"- [ ] Dit staat in de front matter en is geen taak",
			"---",
			"- [ ] Bellen",
		].join("\n");

		const tasks = outlineNote(content);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].fields.description).toContain("Bellen");
	});

	it("sees a heading on the marked line", () => {
		const lines = linesOf(`${BOM}# Plan\n\n## Deze week\n- [ ] Bellen`);

		expect(headingsOf(lines).map((heading) => heading.text)).toEqual([
			"Plan",
			"Deze week",
		]);
	});

	it("puts a task on the marked line on the wheel", () => {
		const tree = buildTree(
			[{ path: NOTE, content: `${BOM}- [ ] Bellen\n- [ ] Mailen` }],
			DEFAULT_PARSE_OPTIONS,
		);

		expect(tree.root.totalTaskCount).toBe(2);
		expect(layoutWheel(tree).nodes.map((node) => node.node.label)).toContain(
			"Bellen",
		);
	});

	it("would have lost that first task before", () => {
		// The defect itself, spelled out: with the mark still attached, the task
		// pattern refuses the line and nothing anywhere says a task went missing.
		const marked = `${BOM}- [ ] Bellen`;
		expect(outlineNote(marked)).toHaveLength(1);
		expect(marked.split(/\r?\n/)[0]).not.toBe("- [ ] Bellen");
	});
});

describe("writing to a note that starts with a mark", () => {
	it("ticks the first line off and keeps the mark", async () => {
		notes.set(NOTE, `${BOM}- [ ] Bellen\n- [ ] Mailen\n`);

		const outcome = await writeDone(app, {
			path: NOTE,
			line: 0,
			raw: "- [ ] Bellen",
		});

		expect(outcome).toBe("written");
		expect(notes.get(NOTE)?.startsWith(BOM)).toBe(true);
		expect(notes.get(NOTE)).toBe(`${BOM}- [x] Bellen\n- [ ] Mailen\n`);
	});

	it("moves a task under a heading and keeps the mark", async () => {
		notes.set(NOTE, `${BOM}- [ ] Bellen\n## Later\n- [ ] Iets\n`);

		const outcome = await writeMoveTo(
			app,
			{ path: NOTE, line: 0, raw: "- [ ] Bellen" },
			{ line: 1, raw: "## Later" },
		);

		expect(outcome).toBe("written");
		expect(notes.get(NOTE)?.startsWith(BOM)).toBe(true);
		expect(linesOf(notes.get(NOTE) ?? "")).toEqual([
			"## Later",
			"- [ ] Iets",
			"- [ ] Bellen",
			"",
		]);
	});

	it("leaves a note without a mark exactly as it was", async () => {
		notes.set(NOTE, "- [ ] Bellen\n");

		await writeDone(app, { path: NOTE, line: 0, raw: "- [ ] Bellen" });

		expect(notes.get(NOTE)).toBe("- [x] Bellen\n");
		expect(notes.get(NOTE)?.startsWith(BOM)).toBe(false);
	});

	it("keeps the mark and the CRLF endings together", async () => {
		notes.set(NOTE, `${BOM}- [ ] Bellen\r\n- [ ] Mailen\r\n`);

		await writeDone(app, { path: NOTE, line: 0, raw: "- [ ] Bellen" });

		expect(notes.get(NOTE)).toBe(`${BOM}- [x] Bellen\r\n- [ ] Mailen\r\n`);
	});
});
