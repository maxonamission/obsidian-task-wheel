import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	TaskWheelSettingTab,
	FILTER_FIELDS,
	FILTER_LISTS,
	filterOf,
	setFilter,
	stateFor,
	type TaskWheelSettings,
} from "../settings";
import { NO_FILTER, VAULT_SCOPE, type WheelScope } from "../model/types";
import { windowLabels } from "../view/filter-labels";

/**
 * The settings tab's filter group and the panel beside the wheel (BC_E3_S177).
 *
 * They are the same filter, and the owner had to ask whether they were
 * (8 sep 2026): the group named the wheel it belonged to and said nothing about
 * being a second copy or a one-way door. It is neither. What it *was* doing
 * wrong is writing straight onto the field, past the round boundary that
 * `setFilter` is: a new selection is a new round, and the marks of what you had
 * already been past are given up out loud rather than pruned away in silence at
 * the next read.
 */

const FOLDER: WheelScope = { kind: "folder", path: "Werk" };

const fresh = (): TaskWheelSettings => structuredClone(DEFAULT_SETTINGS);

describe("the filter in the settings tab", () => {
	it("is the vault wheel's filter, and no other wheel's", () => {
		const s = fresh();
		setFilter(s, FOLDER, { ...NO_FILTER, heading: "Beheer" });
		setFilter(s, VAULT_SCOPE, { ...NO_FILTER, heading: "Deze week" });

		expect(filterOf(s, VAULT_SCOPE).heading).toBe("Deze week");
		expect(filterOf(s, FOLDER).heading).toBe("Beheer");
	});

	it("can be cleared again from the panel beside that wheel", () => {
		const s = fresh();
		setFilter(s, VAULT_SCOPE, { ...NO_FILTER, heading: "Deze week" });
		setFilter(s, VAULT_SCOPE, { ...NO_FILTER });

		expect(filterOf(s, VAULT_SCOPE).heading).toBe("");
		expect(s.filterHeading).toBe("");
	});

	/**
	 * The map is what makes the tab's controls take the same road as the panel.
	 * A filter field added to `TaskFilter` and not to the map would go back to
	 * writing past the round boundary, which is exactly the defect this story
	 * removed, and nothing else would notice.
	 */
	it("knows every field a filter has", () => {
		const mapped = new Set([
			...Object.values(FILTER_FIELDS),
			...Object.values(FILTER_LISTS),
		]);
		expect([...mapped].sort()).toEqual(Object.keys(NO_FILTER).sort());
	});

	/**
	 * And every control in the tab that writes a filter field is in it. Read
	 * from the source, because a control is a literal in a definition list and
	 * there is nothing else that would object.
	 */
	it("routes every filter control in the tab through that map", () => {
		const text = readFileSync(join(__dirname, "..", "settings.ts"), "utf8");
		const known = new Set([
			...Object.keys(FILTER_FIELDS),
			...Object.keys(FILTER_LISTS),
		]);

		const unrouted: string[] = [];
		for (const match of text.matchAll(/\bkey: "(filter[A-Za-z]*)"/g)) {
			if (!known.has(match[1])) unrouted.push(match[1]);
		}

		expect(unrouted).toEqual([]);
	});

	/**
	 * The round boundary itself, on the call the tab now makes. A change gives
	 * up the marks and reports how many; a change that alters nothing costs
	 * nothing, so flipping a control back to what it said keeps your round.
	 */
	it("gives up the round on a change, and says how much", () => {
		const s = fresh();
		stateFor(s, VAULT_SCOPE).seen = ["a", "b", "c"];

		const changed = setFilter(s, VAULT_SCOPE, {
			...NO_FILTER,
			heading: "Deze week",
		});
		expect(changed.restarted).toBe(3);
		expect(stateFor(s, VAULT_SCOPE).seen).toEqual([]);

		stateFor(s, VAULT_SCOPE).seen = ["a"];
		const same = setFilter(s, VAULT_SCOPE, filterOf(s, VAULT_SCOPE));
		expect(same.restarted).toBe(0);
		expect(stateFor(s, VAULT_SCOPE).seen).toEqual(["a"]);
	});
});

/**
 * The tab's own write path, which is where the defect lived.
 *
 * `setControlValue` is what a control calls, and it wrote straight onto the
 * field. Reachable here because the Obsidian stub carries `PluginSettingTab`;
 * the plugin under it is the two things the tab actually uses.
 */
describe("changing the filter from the settings tab", () => {
	const tabFor = (settings: TaskWheelSettings) => {
		const saved = vi.fn(() => Promise.resolve());
		const plugin = { settings, saveSettings: saved } as never;
		return { tab: new TaskWheelSettingTab({} as never, plugin), saved };
	};

	it("gives up the round, exactly as the panel does", async () => {
		const s = fresh();
		stateFor(s, VAULT_SCOPE).seen = ["a", "b", "c"];

		const { tab, saved } = tabFor(s);
		await tab.setControlValue("filterHeading", "Deze week");

		expect(filterOf(s, VAULT_SCOPE).heading).toBe("Deze week");
		expect(stateFor(s, VAULT_SCOPE).seen).toEqual([]);
		expect(saved).toHaveBeenCalled();
	});

	it("keeps the round when the control lands on what it already said", async () => {
		const s = fresh();
		setFilter(s, VAULT_SCOPE, { ...NO_FILTER, heading: "Deze week" });
		stateFor(s, VAULT_SCOPE).seen = ["a", "b"];

		const { tab } = tabFor(s);
		await tab.setControlValue("filterHeading", "Deze week");

		expect(stateFor(s, VAULT_SCOPE).seen).toEqual(["a", "b"]);
	});

	it("leaves the filter of every other wheel alone", async () => {
		const s = fresh();
		setFilter(s, FOLDER, { ...NO_FILTER, heading: "Beheer" });
		stateFor(s, FOLDER).seen = ["x"];

		const { tab } = tabFor(s);
		await tab.setControlValue("filterHeading", "Deze week");

		expect(filterOf(s, FOLDER).heading).toBe("Beheer");
		expect(stateFor(s, FOLDER).seen).toEqual(["x"]);
	});

	it("puts a tag row through the same boundary", async () => {
		const s = fresh();
		setFilter(s, VAULT_SCOPE, { ...NO_FILTER, withTags: ["werk"] });
		stateFor(s, VAULT_SCOPE).seen = ["a"];

		const { tab } = tabFor(s);
		await tab.setControlValue("filterWithTags.0", "thuis");

		expect(filterOf(s, VAULT_SCOPE).withTags).toEqual(["thuis"]);
		expect(stateFor(s, VAULT_SCOPE).seen).toEqual([]);
	});

	it("does not treat a setting that is not a filter as one", async () => {
		// `filterPanelOpen` is furniture: whether the panel is folded open says
		// nothing about which tasks are in the round.
		const s = fresh();
		stateFor(s, VAULT_SCOPE).seen = ["a", "b"];

		const { tab } = tabFor(s);
		await tab.setControlValue("fallbackDomain", "Overig");

		expect(s.fallbackDomain).toBe("Overig");
	});
});

/**
 * The two ways into the same filter offer the same thing (BC_E3_S170).
 *
 * The tab had `Priority at least` and not its ceiling, while the panel has
 * both — so a ceiling set beside the wheel was invisible in the settings and
 * could only be undone with *Clear*. And the tab's two window rows said "Due"
 * flat out, while the window has been able to read ⏳ or 🛫 since BC_E3_S126:
 * the same lie BC_E3_S140 took out of the rule names, still standing in the
 * rows below them.
 */
describe("the tab and the panel beside the wheel", () => {
	const src = (name: string): string =>
		readFileSync(join(__dirname, "..", name), "utf8");

	/** Every filter key a file wires a control to. */
	const wired = (text: string): Set<string> => {
		const keys = new Set<string>();
		for (const m of text.matchAll(/\bkey: "(filter[A-Za-z]*)"/g)) keys.add(m[1]);
		return keys;
	};

	it("offers every filter field in the tab, the ceiling included", () => {
		const tab = wired(src("settings.ts"));
		const missing = Object.keys(FILTER_FIELDS).filter((key) => !tab.has(key));

		// The lists live in `filterWithTags.N` rows and are wired per row, so
		// they are checked by the map test above rather than here.
		expect(missing).toEqual([]);
	});

	it("names the ends of a date window after the date they read", () => {
		expect(windowLabels("due")).toEqual({
			from: "Due from",
			until: "Due up to",
		});
		expect(windowLabels("scheduled")).toEqual({
			from: "Scheduled from",
			until: "Scheduled up to",
		});
		expect(windowLabels("start")).toEqual({
			from: "Start from",
			until: "Start up to",
		});
	});

	/**
	 * And both surfaces ask that helper rather than writing the words out.
	 * Two names in two files is how these two drifted apart in the first place.
	 */
	it("has both surfaces asking the same helper for those names", () => {
		for (const file of ["settings.ts", "view/filter-panel.ts"]) {
			const text = src(file);
			expect(text, file).toContain("windowLabels(");
			expect(text, file).not.toContain('"Due from"');
			expect(text, file).not.toContain('"Due up to"');
		}
	});
});
