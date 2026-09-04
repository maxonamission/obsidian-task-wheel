import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import {
	isTaskNote,
	isTaskNoteFinished,
	taskNoteLabel,
	taskNoteState,
} from "../parse/task-note";
import { isNoteTask, renameRefusal } from "../model/scope";
import {
	DEFAULT_PARSE_OPTIONS,
	NO_FILTER,
	type NoteInput,
	type ParseOptions,
	VAULT_SCOPE,
	type WheelNode,
} from "../model/types";

/**
 * A note that is itself one task (BC_E3_S130).
 *
 * The three questions these tests keep apart, because they failed apart in
 * every design that skipped one: *is* this note a task, is it **finished**, and
 * what happens to the work still open **inside** a finished one.
 */

/** Settings that turn the feature on the plain way: `type: task`. */
const MARKED: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	taskNoteProperty: "type",
	taskNoteValue: "task",
};

function note(
	path: string,
	content: string,
	frontmatter: Record<string, unknown>,
	tags: string[] = [],
): NoteInput {
	return { path, content, frontmatter, frontmatterTags: tags };
}

function tasksInOrder(node: WheelNode, out: WheelNode[] = []): WheelNode[] {
	if (node.kind === "task") out.push(node);
	for (const child of node.children) tasksInOrder(child, out);
	return out;
}

function labels(node: WheelNode): string[] {
	return tasksInOrder(node).map((task) => task.label);
}

function find(node: WheelNode, label: string): WheelNode | null {
	if (node.label === label) return node;
	for (const child of node.children) {
		const hit = find(child, label);
		if (hit !== null) return hit;
	}
	return null;
}

describe("recognising a note that is a task", () => {
	it("is off until a property is named", () => {
		const doc = note("Werk/Migratie.md", "# Migratie", { type: "task" });
		expect(isTaskNote(doc, DEFAULT_PARSE_OPTIONS)).toBe(false);
	});

	it("matches a property and a value", () => {
		const doc = note("Werk/Migratie.md", "# Migratie", { type: "task" });
		expect(isTaskNote(doc, MARKED)).toBe(true);
		expect(isTaskNote(note("a.md", "", { type: "meeting" }), MARKED)).toBe(false);
		expect(isTaskNote(note("a.md", "", {}), MARKED)).toBe(false);
	});

	it("takes the bare presence of a property when no value is asked for", () => {
		// The id-style marker: the value differs in every note, so only having it
		// means anything. A hard-coded key would have missed this whole family.
		const options: ParseOptions = {
			...DEFAULT_PARSE_OPTIONS,
			taskNoteProperty: "operonId",
		};
		expect(isTaskNote(note("a.md", "", { operonId: "task-123" }), options)).toBe(true);
		expect(isTaskNote(note("a.md", "", { operonId: "" }), options)).toBe(false);
		expect(isTaskNote(note("a.md", "", { other: "x" }), options)).toBe(false);
	});
});

describe("when such a note is finished", () => {
	const done: ParseOptions = MARKED;

	it("reads the status property, ignoring case", () => {
		expect(isTaskNoteFinished(note("a.md", "", { status: "Done" }), done)).toBe(true);
		expect(isTaskNoteFinished(note("a.md", "", { status: "doing" }), done)).toBe(false);
		expect(isTaskNoteFinished(note("a.md", "", {}), done)).toBe(false);
	});

	it("matches a namespaced status on its last part", () => {
		// The reason this rule exists: statuses are not always bare words, and a
		// literal test on `done` would leave every `Project.Done` note in the
		// round for ever, with nothing on screen to explain why.
		expect(
			isTaskNoteFinished(note("a.md", "", { status: "Project.Done" }), done),
		).toBe(true);
		expect(
			isTaskNoteFinished(note("a.md", "", { status: "Project.InProgress" }), done),
		).toBe(false);
	});

	it("compares a dotted setting whole", () => {
		const exact: ParseOptions = { ...MARKED, taskNoteDoneValue: "Project.Done" };
		expect(isTaskNoteFinished(note("a.md", "", { status: "Project.Done" }), exact)).toBe(
			true,
		);
		expect(isTaskNoteFinished(note("a.md", "", { status: "done" }), exact)).toBe(false);
	});

	it("reads the extra list as finished too", () => {
		// For a vault whose documents end in more ways than two.
		const more: ParseOptions = { ...MARKED, taskNoteDoneValues: ["archived"] };
		expect(isTaskNoteFinished(note("a.md", "", { status: "archived" }), more)).toBe(true);
		expect(isTaskNoteFinished(note("a.md", "", { status: "archived" }), MARKED)).toBe(
			false,
		);
	});

	it("counts every task note as open when nothing is configured", () => {
		const none: ParseOptions = { ...MARKED, taskNoteDoneProperty: "" };
		expect(isTaskNoteFinished(note("a.md", "", { status: "done" }), none)).toBe(false);
	});
});

describe("the four states", () => {
	it("maps each configured word onto the state it stands for", () => {
		const at = (status: string): string =>
			taskNoteState(note("a.md", "", { status }), MARKED);

		expect(at("todo")).toBe("open");
		expect(at("doing")).toBe("in-progress");
		expect(at("done")).toBe("done");
		expect(at("cancelled")).toBe("cancelled");
	});

	it("leaves a status it does not know as open", () => {
		// The reason this matters: a vault knows more statuses than the wheel has
		// states — `backlog`, `on hold` — and work must not fall out of a round
		// because of a word we failed to recognise (eigenaar, 4 sep 2026).
		expect(taskNoteState(note("a.md", "", { status: "on hold" }), MARKED)).toBe("open");
		expect(taskNoteState(note("a.md", "", { status: "backlog" }), MARKED)).toBe("open");
	});

	it("wears the state on the wheel, brackets and all", () => {
		const doc = note("Werk/Bellen.md", "", { type: "task", status: "doing" });
		const tree = buildTree([doc], MARKED);
		const task = find(tree.root, "Bellen");

		expect(task?.fields?.state).toBe("in-progress");
		expect(task?.fields?.statusChar).toBe("/");
	});
});

describe("what it is called", () => {
	it("is the note's title, which is its file name", () => {
		expect(taskNoteLabel(note("Werk/Draft migration guide.md", "Some text", {}))).toBe(
			"Draft migration guide",
		);
	});

	it("does not go looking for a first heading that says something else", () => {
		// The file name is what a link carries and what the file list shows. A
		// wheel labelling the same note differently would be two names for one
		// thing, and the reader would have to hold both.
		expect(taskNoteLabel(note("Werk/mig-01.md", "# Draft migration guide", {}))).toBe(
			"mig-01",
		);
	});
});

describe("on the wheel", () => {
	const doc = note(
		"Werk/Migratie.md",
		["# Migratie", "", "- [ ] Ask the DBA", "- [ ] Write it up"].join("\n"),
		{ type: "task" },
		["klant"],
	);

	it("is one task, with the checkboxes inside it as its subtasks", () => {
		const tree = buildTree([doc], MARKED);
		const parent = find(tree.root, "Migratie");

		expect(parent?.kind).toBe("task");
		expect(labels(parent as WheelNode)).toEqual([
			"Migratie",
			"Ask the DBA",
			"Write it up",
		]);
	});

	it("counts as one item of the round", () => {
		const plain = buildTree([doc], DEFAULT_PARSE_OPTIONS);
		const asTask = buildTree([doc], MARKED);

		expect(plain.root.shownTaskCount).toBe(2);
		expect(asTask.root.shownTaskCount).toBe(3);
	});

	it("carries the note's own tags, so the filter can reach it", () => {
		const tree = buildTree([doc], MARKED);
		expect(find(tree.root, "Migratie")?.fields?.tags).toEqual(["klant"]);
	});

	it("hangs where the folder says, like anything else", () => {
		const tree = buildTree([doc], MARKED);
		expect(tree.domains).toEqual(["Werk"]);
	});

	it("appears even when it holds no checkbox at all", () => {
		// The ordinary task note: a title, a paragraph, no list. Before this it
		// was a note without tasks, which is to say invisible.
		const bare = note("Werk/Bel de notaris.md", "Over de akte.", {
			type: "task",
		});
		const tree = buildTree([bare], MARKED);

		expect(labels(tree.root)).toEqual(["Bel de notaris"]);
	});

	it("has no line to write to", () => {
		// What keeps every edit path off line 0 of the note: fields, because its
		// tags and status are real — but a source that says "a whole note".
		const tree = buildTree([doc], MARKED);
		const parent = find(tree.root, "Migratie");

		expect(parent?.source?.raw).toBeNull();
		expect(parent?.fields?.raw).toBe("");
	});

	it("sends a rename to the file list rather than nowhere", () => {
		const tree = buildTree([doc], MARKED);
		const parent = find(tree.root, "Migratie") as WheelNode;

		expect(
			renameRefusal(
				{ kind: parent.kind, depth: parent.depth, label: parent.label, source: parent.source },
				VAULT_SCOPE,
				"folder",
			),
		).toEqual({ refused: "note" });
	});
});

describe("a finished task note", () => {
	it("leaves the round", () => {
		const done = note("Werk/Af.md", "# Af\n", { type: "task", status: "done" });
		const tree = buildTree([done], MARKED);

		expect(labels(tree.root)).toEqual([]);
	});

	it("still shows the work left open inside it", () => {
		// The rule that keeps §2.3 intact: dropping the note whole would take
		// open checkboxes off the wheel without saying so. It falls back to being
		// the note it was, and the open work stays where it was.
		const done = note(
			"Werk/Af.md",
			"# Af\n\n- [x] Gedaan\n- [ ] Nog niet\n",
			{ type: "task", status: "done" },
		);
		const tree = buildTree([done], MARKED);

		expect(labels(tree.root)).toEqual(["Nog niet"]);
		expect(find(tree.root, "Af")?.kind).toBe("project");
	});
});

describe("a task note the filter leaves out", () => {
	it("goes back to being a note, and is counted as left out", () => {
		const doc = note(
			"Werk/Migratie.md",
			"# Migratie\n\n- [ ] Ask the DBA #urgent\n",
			{ type: "task" },
			["klant"],
		);
		const options: ParseOptions = {
			...MARKED,
			filter: { ...NO_FILTER, withTags: ["urgent"] },
		};
		const tree = buildTree([doc], options);

		// The task inside it matches and stays; the note itself does not, and
		// its own tasks are judged on their own merits — exactly as before this
		// note ever claimed to be one.
		expect(labels(tree.root)).toEqual(["Ask the DBA"]);
		expect(tree.filteredOut).toBe(1);
	});
});

describe("on a wheel over that very note", () => {
	it("stays the wheel rather than becoming a task inside itself", () => {
		const doc = note("Werk/Migratie.md", "# Migratie\n\n## Stappen\n\n- [ ] Een\n", {
			type: "task",
		});
		const tree = buildTree([doc], {
			...MARKED,
			scope: { kind: "note", path: "Werk/Migratie.md" },
		});

		expect(labels(tree.root)).toEqual(["Een"]);
	});
});

describe("what a task note may not do", () => {
	/**
	 * The trap this closes (eigenaar, 4 sep 2026). Carrying lifts the task
	 * *lines* out of a note and leaves the file behind. On a task document that
	 * empties the very thing the reader asked to move — and the second attempt
	 * then says "nothing in that note is in this round", which is true and
	 * completely beside the point.
	 */
	it("is recognised as a task that is a whole note", () => {
		const doc = note("Werk/Migratie.md", "# Migratie\n\n- [ ] Bellen\n", {
			type: "task",
		});
		const tree = buildTree([doc], MARKED);

		expect(isNoteTask(find(tree.root, "Migratie") as WheelNode)).toBe(true);
		expect(isNoteTask(find(tree.root, "Bellen") as WheelNode)).toBe(false);
	});

	it("does not mistake a heading with no line of its own for one", () => {
		expect(
			isNoteTask({ kind: "group", source: undefined }),
		).toBe(false);
	});
});
