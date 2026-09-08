import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { presetsAfterRename } from "../model/presets";
import type { CarryPreset } from "../model/types";

/**
 * A named destination follows the note it names (BC_E3_S178).
 *
 * It held a path and nothing kept it current, so renaming the note — or a
 * folder above it, which is the ordinary case — left it pointing at a place
 * that was not there. Carrying then refused, correctly and unhelpfully: the
 * note *was* there, under another name (eigenaar, 8 sep 2026).
 */

const preset = (name: string, notePath: string): CarryPreset => ({
	name,
	notePath,
	headingPath: null,
	how: "move",
});

const paths = (presets: readonly CarryPreset[]): string[] =>
	presets.map((p) => p.notePath);

describe("a destination after a rename", () => {
	const PRESETS = [
		preset("Vandaag", "_Tasks/Vandaag.md"),
		preset("Maybe", "_Tasks/MaybeLater.md"),
		preset("Elders", "Werk/Plan.md"),
	];

	it("follows the note when the note is renamed", () => {
		const { presets, moved } = presetsAfterRename(
			PRESETS,
			"_Tasks/Vandaag.md",
			"_Tasks/Today.md",
		);

		expect(moved).toBe(1);
		expect(paths(presets)).toEqual([
			"_Tasks/Today.md",
			"_Tasks/MaybeLater.md",
			"Werk/Plan.md",
		]);
	});

	it("follows the note when it is moved to another folder", () => {
		const { presets } = presetsAfterRename(
			PRESETS,
			"_Tasks/Vandaag.md",
			"Archief/2026/Vandaag.md",
		);

		expect(paths(presets)[0]).toBe("Archief/2026/Vandaag.md");
	});

	/**
	 * The case the owner met, and the one a per-file listener would miss:
	 * Obsidian fires a single rename for the folder, not one per file inside.
	 */
	it("follows every destination in a renamed folder", () => {
		const { presets, moved } = presetsAfterRename(PRESETS, "_Tasks", "Taken");

		expect(moved).toBe(2);
		expect(paths(presets)).toEqual([
			"Taken/Vandaag.md",
			"Taken/MaybeLater.md",
			"Werk/Plan.md",
		]);
	});

	it("follows a folder moved deeper in as well", () => {
		const { presets } = presetsAfterRename(PRESETS, "_Tasks", "Archief/_Tasks");

		expect(paths(presets).slice(0, 2)).toEqual([
			"Archief/_Tasks/Vandaag.md",
			"Archief/_Tasks/MaybeLater.md",
		]);
	});

	it("leaves a destination alone when the rename is not about it", () => {
		const { presets, moved } = presetsAfterRename(
			PRESETS,
			"Privé/Boodschappen.md",
			"Privé/Lijstje.md",
		);

		expect(moved).toBe(0);
		expect(paths(presets)).toEqual(paths(PRESETS));
	});

	/**
	 * A folder whose name merely *starts* like another one is a different
	 * folder. Without the separator, renaming `_Task` would drag `_Tasks/…`
	 * along with it.
	 */
	it("does not mistake a folder for one whose name it starts with", () => {
		const { moved } = presetsAfterRename(PRESETS, "_Task", "Taken");
		expect(moved).toBe(0);
	});

	it("keeps the name and the rest of the destination", () => {
		const withHeading: CarryPreset[] = [
			{
				name: "Vandaag",
				notePath: "_Tasks/Vandaag.md",
				headingPath: ["Werk", "Deze week"],
				how: "copy",
			},
		];

		const { presets } = presetsAfterRename(
			withHeading,
			"_Tasks/Vandaag.md",
			"_Tasks/Today.md",
		);

		expect(presets[0]).toEqual({
			name: "Vandaag",
			notePath: "_Tasks/Today.md",
			headingPath: ["Werk", "Deze week"],
			how: "copy",
		});
	});

	it("does nothing when the path did not actually change", () => {
		const { moved } = presetsAfterRename(
			PRESETS,
			"_Tasks/Vandaag.md",
			"_Tasks/Vandaag.md",
		);
		expect(moved).toBe(0);
	});
});

/**
 * That the rule is actually wired to the event.
 *
 * The rule above is pure and testable; the listener that hands it two strings
 * needs a running Obsidian, so this reads the source instead. It is here
 * because the rule being right buys nothing if nobody calls it, and that is
 * exactly the failure mode a pure function invites.
 */
describe("the listener behind it", () => {
	const main = readFileSync(join(__dirname, "..", "main.ts"), "utf8");

	it("runs on the vault's rename event", () => {
		const listener = main.slice(
			main.indexOf('this.app.vault.on("rename"'),
		);
		expect(main).toContain('this.app.vault.on("rename"');
		expect(listener.slice(0, 600)).toContain("presetsAfterRename");
	});

	it("writes only when a destination actually moved", () => {
		// Most renames touch none, and each write serialises every setting.
		const listener = main.slice(
			main.indexOf('this.app.vault.on("rename"'),
		);
		expect(listener.slice(0, 600)).toContain("moved === 0");
	});
});
