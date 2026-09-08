import { beforeEach, describe as group, expect, it } from "vitest";
import type { TFile } from "obsidian";
// The stub itself, not the alias: `tsc` builds against Obsidian's own types,
// where `Notice` has no list of what it has said (BC_E3_S171). Under vitest the
// alias makes this the very class the plugin constructs.
import { Notice } from "./fixtures/obsidian-stub";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import { actionsFor, type EditHost, lineRefOf, moveFocused } from "../view/task-edits";
import { activates, isNoteTask } from "../model/scope";
import { DEFAULT_SETTINGS } from "../settings";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	VAULT_SCOPE,
	type WheelScope,
} from "../model/types";
import type { LaidOutNode } from "../layout/radial";

/**
 * The keyboard is not poorer than the mouse (BC_E3_S99, herzien BC_E3_S171).
 *
 * Two places where it was, found by the audit of 6 sep 2026. Enter on a task
 * document said *this task is a note — open it to edit its text* while a click
 * on that same title renamed it on the spot. And Alt+↑/↓ on a heading did
 * nothing at all: the controller calls `preventDefault` before it asks, so the
 * press was claimed and then swallowed, while the card's own menu had offered
 * *Move up* and *Move down* on a heading all along.
 */

const PATH = "Werk/Plan.md";

const NOTES: NoteInput[] = [
	{
		path: PATH,
		content: [
			"# Plan",
			"",
			"## Deze week",
			"- [ ] Bellen",
			"",
			"## Volgende week",
			"- [ ] Mailen",
		].join("\n"),
	},
	{
		// A note that says it is itself a task (BC_E3_S130): fields, no line.
		path: "Werk/Groot project.md",
		frontmatter: { type: "taak" },
		content: "Een document dat zelf een taak is.",
	},
];

const settings = () => ({
	...structuredClone(DEFAULT_SETTINGS),
	taskNoteProperty: "type",
	taskNoteValue: "taak",
});

function nodes(scope: WheelScope): LaidOutNode[] {
	const options = {
		...DEFAULT_PARSE_OPTIONS,
		scope,
		taskNoteProperty: "type",
		taskNoteValue: "taak",
	};
	const tree = buildTree(NOTES, options);
	return layoutWheel(tree, { focusId: null }).nodes;
}

function find(scope: WheelScope, label: string): LaidOutNode {
	const found = nodes(scope).find((laid) => laid.node.label === label);
	if (found === undefined) throw new Error(`no node labelled ${label}`);
	return found;
}

const asked = { section: 0 };

const unused =
	(name: string) =>
	(): never => {
		throw new Error(`this test should not have needed ${name}`);
	};

function host(scope: WheelScope, laid: LaidOutNode | null): EditHost {
	return {
		app: { vault: { getAbstractFileByPath: (): TFile | null => null }, workspace: {} } as never,
		settings: settings(),
		scope: () => scope,
		refreshCarrying: () => Promise.resolve(),
		trace: () => undefined,
		carryHost: unused("carryHost"),
		sectionHost: () => {
			asked.section += 1;
			// Enough of a host to be handed over; the move itself reaches the
			// vault, which this stub answers with "gone" — the question here is
			// only whether the key found the action at all.
			return {
				app: { vault: { getAbstractFileByPath: (): TFile | null => null } },
				refresh: () => Promise.resolve(),
				refreshCarrying: () => Promise.resolve(),
				trace: () => undefined,
			} as never;
		},
		focusId: () => laid?.id ?? null,
		layout: () => (laid === null ? null : ({ byId: new Map([[laid.id, laid]]) } as never)),
		openNote: unused("openNote"),
		openScopeFor: unused("openScopeFor"),
		stepFromCard: unused("stepFromCard"),
		toggleFold: unused("toggleFold"),
	};
}

beforeEach(() => {
	Notice.shown.length = 0;
	asked.section = 0;
});

group("Enter, per kind of node", () => {
	const NOTE_WHEEL: WheelScope = { kind: "note", path: PATH };

	it("opens a wheel over what has an inside", () => {
		for (const label of ["Deze week", "Volgende week"]) {
			expect(activates(find(NOTE_WHEEL, label).node.kind)).toBe("wheel");
		}
	});

	/**
	 * The case the report was about.
	 *
	 * Both halves matter: the card offers a rename, and the key's own test —
	 * `lineRefOf === null && isNoteTask` — is what now sends it to that same
	 * box instead of to a notice.
	 */
	it("sends a task document to the box the card would have opened", () => {
		const laid = find(VAULT_SCOPE, "Groot project");
		expect(isNoteTask(laid.node)).toBe(true);
		expect(lineRefOf(laid)).toBeNull();

		// What the mouse gets when it clicks that title.
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).rename).toBeDefined();
		// And the card only makes a title editable when the node has fields.
		expect(laid.node.fields).toBeDefined();
	});

	it("still refuses a task with neither a line nor a file", () => {
		// Nothing in the fixture is one; the guard is the pair of conditions
		// above, and this pins that both are needed rather than either.
		const onLine = find(VAULT_SCOPE, "Bellen");
		expect(isNoteTask(onLine.node)).toBe(false);
		expect(lineRefOf(onLine)).not.toBeNull();
	});
});

group("Alt with an arrow, per kind of node", () => {
	const NOTE_WHEEL: WheelScope = { kind: "note", path: PATH };

	it("moves a heading, which is what its own menu offers", () => {
		const laid = find(NOTE_WHEEL, "Deze week");
		const card = actionsFor(host(NOTE_WHEEL, laid), laid);
		expect(card.section?.move).toBeDefined();

		moveFocused(host(NOTE_WHEEL, laid), "up");
		// The move itself reaches the vault, which this stub answers with
		// "gone" — what is being pinned here is that the key found the action
		// rather than falling through to "there is nothing here to move".
		expect(asked.section).toBeGreaterThan(0);
		expect(Notice.shown.join(" ")).not.toContain("move its headings");
		expect(Notice.shown.join(" ")).not.toContain("nothing here to move");
	});

	/**
	 * And where the menu offers nothing, the key says so.
	 *
	 * A heading on the vault wheel has no section menu — the wedge there is a
	 * folder or a tag, not a line to edit. The press is claimed by the
	 * controller before this runs, so saying nothing would be the wheel doing
	 * nothing and reporting nothing (§3.3).
	 */
	it("says why, rather than swallowing the press", () => {
		const laid = find(VAULT_SCOPE, "Deze week");
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).section).toBeUndefined();

		moveFocused(host(VAULT_SCOPE, laid), "down");
		expect(asked.section).toBe(0);
		expect(Notice.shown).toHaveLength(1);
		expect(Notice.shown[0]).toContain("move its headings");
	});

	it("still moves a task on a line", () => {
		const laid = find(NOTE_WHEEL, "Bellen");
		expect(lineRefOf(laid)).not.toBeNull();

		moveFocused(host(NOTE_WHEEL, laid), "down");
		// The write path is `act`, tested in task-edits.test.ts; what matters
		// here is that it never reached either of the two refusals.
		expect(asked.section).toBe(0);
		expect(Notice.shown.join(" ")).not.toContain("nothing here to move");
	});
});
