import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { act, actionsFor, type EditHost } from "../view/task-edits";
import type { AfterWrite } from "../model/carry";
import type { LineRef } from "../vault/writeback";
import { DEFAULT_SETTINGS } from "../settings";
import { VAULT_SCOPE } from "../model/types";

/**
 * One review action, asked without an Obsidian window (BC_E3_S162).
 *
 * `act` was a private method on an `ItemView`, and two of the audit's findings
 * of 6 sep 2026 lived in it: a write the vault refused still moved the wheel on
 * and marked the next task as seen, and the aim of an action outlived the
 * action itself. Neither could have been caught by a test, because the only way
 * in was through a view that needs a browser.
 *
 * This is that way in. The vault is a map of strings; the one thing the view
 * still does — settle up afterwards — is a spy, and what it was called *with*
 * is the whole question.
 */

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

const settled = vi.fn<(after?: AfterWrite) => Promise<void>>();

/**
 * Everything `act` does not touch is a throw rather than a stub.
 *
 * The host is wide because the card's menu needs it (BC_E3_S162), and a
 * silent `undefined` in an unused corner is how a test starts passing for the
 * wrong reason. `act` reaches the vault and the settling-up, and nothing else
 * here may be reached without saying so out loud.
 */
const unused =
	(name: string) =>
	(): never => {
		throw new Error(`act should not have needed ${name}`);
	};

const host = (): EditHost => ({
	app: { vault, workspace: {} } as never,
	refreshCarrying: settled,
	settings: structuredClone(DEFAULT_SETTINGS),
	scope: () => VAULT_SCOPE,
	trace: () => undefined,
	carryHost: unused("carryHost"),
	sectionHost: unused("sectionHost"),
	focusId: () => null,
	layout: () => null,
	openNote: unused("openNote"),
	openScopeFor: unused("openScopeFor"),
	stepFromCard: unused("stepFromCard"),
	toggleFold: unused("toggleFold"),
});

const at = (line: number, raw: string): LineRef => ({
	path: "Werk/Plan.md",
	line,
	raw,
});

beforeEach(() => {
	notes.clear();
	settled.mockReset();
	settled.mockResolvedValue(undefined);
	notes.set("Werk/Plan.md", "- [ ] Bellen\n- [ ] Mailen\n");
});

describe("act — a write that happened", () => {
	it("ticks the task off and settles up with what the caller asked for", () => {
		const after: AfterWrite = { advance: true };

		return act(host(), { kind: "done" }, at(0, "- [ ] Bellen"), after).then(() => {
			expect(notes.get("Werk/Plan.md")).toContain("- [x] Bellen");
			expect(settled).toHaveBeenCalledWith(after);
		});
	});

	it("rewrites what a task says, leaving the rest of the line alone", async () => {
		notes.set("Werk/Plan.md", "- [ ] Bellen 📅 2026-09-09\n");

		await act(host(), { kind: "text", text: "Bellen Jan" }, at(0, "- [ ] Bellen 📅 2026-09-09"));

		expect(notes.get("Werk/Plan.md")).toBe("- [ ] Bellen Jan 📅 2026-09-09\n");
	});
});

describe("act — a write that did not happen", () => {
	/**
	 * The rule BC_E3_S158 settled, asked here rather than through the view.
	 *
	 * `after` carries the aim: where the wheel should go once this action is
	 * done with the item. A refusal is not being done with it. Passing `after`
	 * on regardless moved the wheel to the next task and marked it **seen**
	 * without anything having been written and without the reader ever turning
	 * there — V3 of the audit of 23 aug 2026, returning through the outcome
	 * instead of through a picker.
	 */
	it("rescans without aiming when the line has changed since the scan", async () => {
		await act(host(), { kind: "done" }, at(0, "- [ ] Iets heel anders"), {
			advance: true,
		});

		expect(notes.get("Werk/Plan.md")).toBe("- [ ] Bellen\n- [ ] Mailen\n");
		expect(settled).toHaveBeenCalledWith({});
	});

	it("does not aim when the note itself is gone", async () => {
		notes.clear();

		await act(host(), { kind: "done" }, at(0, "- [ ] Bellen"), { advance: true });

		expect(settled).toHaveBeenCalledWith({});
	});

	it("says so and settles up with nothing when the press changes nothing", async () => {
		// "Unchanged" is the one outcome that does not refresh at all: there is
		// nothing to redraw, and silence here is what once hid the CRLF defect.
		notes.set("Werk/Plan.md", "- [x] Bellen\n");

		await act(host(), { kind: "status", char: "x" }, at(0, "- [x] Bellen"));

		expect(settled).not.toHaveBeenCalled();
	});
});

describe("actionsFor — what the card offers", () => {
	/**
	 * The decision BC_E3_S162 came to make reachable.
	 *
	 * Which actions an item has is a decision — a heading is not a task, a note
	 * that is itself a task cannot have its line rewritten — and it used to be
	 * a private method on a view. V6 of the audit of 6 sep 2026 is exactly a
	 * disagreement between this decision and the keyboard, and no test could
	 * have put the two side by side.
	 */
	/**
	 * A task carries `fields`; a container does not. That is the difference the
	 * writer keys on — a heading has no task line to rewrite — so the fixture
	 * has to be as honest about it as `build-tree` is.
	 */
	const task = () =>
		({
			id: "x-task",
			node: {
				id: "x-task",
				kind: "task",
				label: "Bellen",
				children: [],
				source: { path: "Werk/Plan.md", line: 0, raw: "- [ ] Bellen" },
				fields: { raw: "- [ ] Bellen", priority: "normal", state: "open" },
			},
		}) as never;

	const heading = () =>
		({
			id: "x-group",
			node: {
				id: "x-group",
				kind: "group",
				label: "Deze week",
				children: [],
				source: { path: "Werk/Plan.md", line: 0, raw: "## Deze week" },
			},
		}) as never;

	it("offers nothing at all when there is nothing under the wedge", () => {
		expect(actionsFor(host(), null)).toEqual({});
	});

	it("gives a task the review actions that write to its line", () => {
		const actions = actionsFor(host(), task());

		expect(actions.done).toBeTypeOf("function");
		expect(actions.defer).toBeTypeOf("function");
	});

	it("does not offer a heading the actions that rewrite a task line", () => {
		// A heading has a section menu of its own; asking it to tick itself off
		// would be asking the writer to change a line that is not a task.
		const actions = actionsFor(host(), heading());

		expect(actions.done).toBeUndefined();
	});
});
