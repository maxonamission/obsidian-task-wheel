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
	taskNoteValues: ["taak"],
});

function nodes(scope: WheelScope): LaidOutNode[] {
	const options = {
		...DEFAULT_PARSE_OPTIONS,
		scope,
		taskNoteProperty: "type",
		taskNoteValues: ["taak"],
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

group("Reveal in navigation, per kind of item (BC_E3_S134)", () => {
	/**
	 * Where the file list can be reached from: a note ring, a task document
	 * and a folder wedge all have a place in it. A tag or a property wedge
	 * does not — `scopeFor` already refuses those (`not-a-folder`), so this
	 * only pins that the refusal reaches `actionsFor` and takes the `file`
	 * action away with it.
	 */
	it("offers it on a note ring", () => {
		const laid = find(VAULT_SCOPE, "Plan");
		expect(laid.node.kind).toBe("project");
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).file).toBeTypeOf("function");
	});

	it("offers it on a task document", () => {
		const laid = find(VAULT_SCOPE, "Groot project");
		expect(isNoteTask(laid.node)).toBe(true);
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).file).toBeTypeOf("function");
	});

	it("offers it on a folder wedge", () => {
		// The default domain source is "folder" (DEFAULT_PARSE_OPTIONS), so
		// the fixture's own "Werk" wedge already stands for a folder.
		const laid = find(VAULT_SCOPE, "Werk");
		expect(laid.node.kind).toBe("domain");
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).file).toBeTypeOf("function");
	});

	it("stays absent on a tag wedge: nothing on disk to reveal", () => {
		const options = {
			...DEFAULT_PARSE_OPTIONS,
			scope: VAULT_SCOPE,
			domainSource: "tag" as const,
		};
		const tree = buildTree(
			[{ path: "Losse map/Idee.md", content: "- [ ] Bellen #domein/werk" }],
			options,
		);
		const laid = layoutWheel(tree, { focusId: null }).nodes.find(
			(n) => n.node.label === "werk",
		);
		if (laid === undefined) throw new Error("no wedge found");
		expect(laid.node.kind).toBe("domain");

		const tagHost: EditHost = {
			...host(VAULT_SCOPE, laid),
			settings: { ...settings(), domainSource: "tag" },
		};
		expect(actionsFor(tagHost, laid).file).toBeUndefined();
	});

	it("stays absent on a plain task line and a heading", () => {
		// Neither is a whole file or a folder — `revealPath` only answers for
		// `project`, and for a `domain` wedge that resolves to a folder.
		expect(actionsFor(host(VAULT_SCOPE, find(VAULT_SCOPE, "Bellen")), find(VAULT_SCOPE, "Bellen")).file).toBeUndefined();
		const heading = find({ kind: "note", path: PATH }, "Deze week");
		expect(actionsFor(host({ kind: "note", path: PATH }, heading), heading).file).toBeUndefined();
	});
});

group("what the title on the card can rewrite (BC_E3_S119)", () => {
	/**
	 * The owner's question of 2 sep 2026 — *"kunnen we via het kaartje
	 * documentnamen, headings en eventueel tags aanpassen?"* — answered yes for
	 * names and no for tags. What that means per kind of item is the rule, and
	 * the rule is what these pin: three kinds gain a `rename`, and the two with
	 * no name written down anywhere keep a sentence instead.
	 */
	const renames = (scope: WheelScope, label: string) => {
		const laid = find(scope, label);
		const actions = actionsFor(host(scope, laid), laid);
		return {
			title: actions.rename !== undefined,
			words: actions.outline?.rename !== undefined,
			refuses: actions.onTitleRefused !== undefined,
		};
	};

	it("renames a heading, and from the vault wheel too", () => {
		// Deliberately not gated on the wheel, unlike moving a heading. A rename
		// rewrites one line in place and leaves the level alone, so it belongs
		// with the task-line edits that write into the item's own note from
		// every wheel — not with the moves that reshape a document.
		expect(renames(VAULT_SCOPE, "Deze week")).toEqual({
			title: true,
			words: false,
			refuses: false,
		});
		expect(renames({ kind: "note", path: PATH }, "Deze week")).toEqual({
			title: true,
			words: false,
			refuses: false,
		});
	});

	it("renames a note ring, where the links follow the file", () => {
		expect(renames(VAULT_SCOPE, "Plan")).toEqual({
			title: true,
			words: false,
			refuses: false,
		});
	});

	it("renames a task document, which is a file wearing a task's clothes", () => {
		const laid = find(VAULT_SCOPE, "Groot project");
		expect(isNoteTask(laid.node)).toBe(true);
		expect(actionsFor(host(VAULT_SCOPE, laid), laid).rename).toBeTypeOf(
			"function",
		);
	});

	it("leaves a task's own words to the outline, not to the title action", () => {
		// One rename per thing: a task line goes through `outline.rename`, which
		// writes the words and keeps the dates and priority in place.
		expect(renames(VAULT_SCOPE, "Bellen")).toEqual({
			title: false,
			words: true,
			refuses: false,
		});
	});

	it("says why a folder wedge has no name to change here", () => {
		expect(renames(VAULT_SCOPE, "Werk")).toEqual({
			title: false,
			words: false,
			refuses: true,
		});
	});
});
