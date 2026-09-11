import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	TaskWheelSettingTab,
	taskNoteValuesOf,
	type TaskWheelSettings,
} from "../settings";

/**
 * *Values it may have* is a list now (BC_E3_S189).
 *
 * It used to be one word, and a reader who wrote two of them separated by a
 * comma got a literal search for `task, project`. No note carries that, so
 * nothing appeared and nothing said why (eigenaar, 11 sep 2026).
 *
 * Two things are tested here and not beside the parser: what a stored file from
 * before the change turns into, and whether the field reads back what went in.
 * Both are about the settings, not about matching — `task-note.test.ts` holds
 * the matching.
 */

describe("reading a stored setting from before the list", () => {
	it("carries the old single value over", () => {
		expect(taskNoteValuesOf({ taskNoteValue: "task" } as never)).toEqual(["task"]);
	});

	it("splits an old value someone had already typed as a list", () => {
		// The old field took a string, so nothing stopped a reader from typing a
		// comma into it. It never worked, but the intent is plain enough to honour.
		expect(taskNoteValuesOf({ taskNoteValue: "task, project" } as never)).toEqual([
			"task",
			"project",
		]);
	});

	it("does not turn an empty old value into a list with nothing in it", () => {
		// Empty means something specific here: carrying the property is enough.
		// A list holding one empty string would not say that.
		expect(taskNoteValuesOf({ taskNoteValue: "" } as never)).toEqual([]);
		expect(taskNoteValuesOf({ taskNoteValue: " , " } as never)).toEqual([]);
	});

	it("leaves a file that already has the list alone", () => {
		expect(taskNoteValuesOf({ taskNoteValues: ["task"] })).toEqual(["task"]);
		// The new key wins even when both are there, which is what a file written
		// by a version in between would look like.
		expect(
			taskNoteValuesOf({ taskNoteValues: ["project"], taskNoteValue: "task" } as never),
		).toEqual(["project"]);
	});

	it("copies rather than shares the stored array", () => {
		// `loadSettings` spreads the other list fields for this reason: keeping the
		// stored object's array would have the settings write into what was read.
		const stored = { taskNoteValues: ["task"] } as never;
		const out = taskNoteValuesOf(stored);
		out.push("project");
		expect((stored as { taskNoteValues: string[] }).taskNoteValues).toEqual(["task"]);
	});

	it("has nothing to carry over when there is no stored file", () => {
		expect(taskNoteValuesOf(null)).toEqual([]);
		expect(taskNoteValuesOf({})).toEqual([]);
	});
});

/**
 * The field itself, through the tab's own read and write path — the same one
 * the three fields beside it already use.
 */
describe("the field in the settings tab", () => {
	const tabFor = (settings: TaskWheelSettings) => {
		const saved = vi.fn(() => Promise.resolve());
		const plugin = { settings, saveSettings: saved } as never;
		return new TaskWheelSettingTab({} as never, plugin);
	};

	it("reads back what was typed", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const tab = tabFor(settings);

		await tab.setControlValue("taskNoteValues", "task, project");
		expect(settings.taskNoteValues).toEqual(["task", "project"]);
		expect(tab.getControlValue("taskNoteValues")).toBe("task, project");
	});

	it("drops the blanks a trailing comma leaves behind", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const tab = tabFor(settings);

		await tab.setControlValue("taskNoteValues", " task ,, project, ");
		expect(settings.taskNoteValues).toEqual(["task", "project"]);
	});

	it("clears to empty, which means the property alone is enough", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const tab = tabFor(settings);

		await tab.setControlValue("taskNoteValues", "task");
		await tab.setControlValue("taskNoteValues", "");
		expect(settings.taskNoteValues).toEqual([]);
		expect(tab.getControlValue("taskNoteValues")).toBe("");
	});
});
