import { describe as group, expect, it } from "vitest";
import { kindWord } from "../model/scope";
import { sourceLine } from "../view/reading-card";
import { buildTree } from "../parse/build-tree";
import { layoutWheel } from "../layout/radial";
import {
	DEFAULT_PARSE_OPTIONS,
	VAULT_SCOPE,
	type NodeKind,
	type SourceRef,
} from "../model/types";

/**
 * Saying what a thing is (BC_E3_S68).
 *
 * The ring is depth, not kind, so a folder, a note, a heading, a task and a
 * subtask all sit on the same kind of dot, and on one ring they stand side by
 * side. That was the right trade for the drawing, and it left the reader with
 * nowhere to read *what* something is. The card is where that is answered, in
 * one word at the head of the line it already had.
 *
 * Two of the five kinds cannot answer from `kind` alone, and both used to get
 * it wrong somewhere:
 *
 *  - a wedge is a folder only when the domain comes from one, which is the
 *    mistake BC_E3_S92 came from;
 *  - a task with no line of its own is a whole note, and the card reported a
 *    placeholder zero about it as *line 1*.
 */

const line = (raw: string | null): SourceRef => ({
	path: "Werk/Plan.md",
	line: 3,
	indent: 0,
	headingPath: [],
	raw,
});

const node = (kind: NodeKind, source?: SourceRef) => ({ kind, source });

group("what a wedge is depends on where the domains come from", () => {
	it("is a folder only when the domain is one", () => {
		const wedge = node("domain");
		expect(kindWord(wedge, "root", "folder")).toBe("Folder");
		expect(kindWord(wedge, "root", "tag")).toBe("Tag");
		expect(kindWord(wedge, "root", "property")).toBe("Note property");
		expect(kindWord(wedge, "root", "heading")).toBe("Heading");
	});
});

group("what a task is depends on what it hangs under", () => {
	it("is a subtask under another task, and a task anywhere else", () => {
		const task = node("task", line("- [ ] Bellen"));
		expect(kindWord(task, "task", "folder")).toBe("Subtask");
		expect(kindWord(task, "group", "folder")).toBe("Task");
		expect(kindWord(task, "project", "folder")).toBe("Task");
	});

	it("is a task document when it has no line of its own", () => {
		// `raw === null` is the wheel's existing signal for "stands for a whole
		// note", the same one every write path already tests.
		const document = node("task", line(null));
		expect(kindWord(document, "domain", "folder")).toBe("Task document");
	});
});

group("the containers say what they are too", () => {
	it("names the note, the heading and the hub", () => {
		expect(kindWord(node("project", line(null)), "domain", "folder")).toBe(
			"Note",
		);
		expect(kindWord(node("group", line("## Deze week")), "project", "folder")).toBe(
			"Heading",
		);
		expect(kindWord(node("root"), null, "folder")).toBe("Vault");
	});
});

group("the line under the card", () => {
	it("gives a wedge a line where it had none", () => {
		expect(sourceLine(node("domain"), "Folder")).toBe("Folder");
	});

	it("counts from one for a task that really has a line", () => {
		expect(sourceLine(node("task", line("- [ ] Bellen")), "Task")).toBe(
			"Task · Werk/Plan.md · line 4",
		);
	});

	it("claims no line for a task document, which has none", () => {
		expect(sourceLine(node("task", line(null)), "Task document")).toBe(
			"Task document · Werk/Plan.md",
		);
	});

	it("keeps the last two steps of the path, no more", () => {
		const deep: SourceRef = { ...line("## Kop"), path: "A/B/C/D/Plan.md" };
		expect(sourceLine(node("group", deep), "Heading")).toBe(
			"Heading · D/Plan.md",
		);
	});
});

group("on a real wheel, every kind answers", () => {
	it("names all five without walking the tree", () => {
		const tree = buildTree(
			[
				{
					path: "Werk/Plan.md",
					content: [
						"# Plan",
						"",
						"## Deze week",
						"- [ ] Bellen",
						"    - [ ] Nummer opzoeken",
					].join("\n"),
				},
				{
					path: "Werk/Migratie.md",
					content: "Bel de DBA.\n",
					frontmatter: { type: "task", status: "doing" },
				},
			],
			{
				...DEFAULT_PARSE_OPTIONS,
				scope: VAULT_SCOPE,
				taskNoteProperty: "type",
				taskNoteValue: "task",
			},
		);
		const layout = layoutWheel(tree, { focusId: null });

		const said = new Map<string, string>();
		for (const laid of layout.nodes) {
			const parent =
				laid.parentId === null
					? null
					: (layout.byId.get(laid.parentId)?.node.kind ?? null);
			said.set(laid.node.label, kindWord(laid.node, parent, "folder"));
		}

		expect(said.get("Werk")).toBe("Folder");
		expect(said.get("Plan")).toBe("Note");
		expect(said.get("Deze week")).toBe("Heading");
		expect(said.get("Bellen")).toBe("Task");
		expect(said.get("Nummer opzoeken")).toBe("Subtask");
		expect(said.get("Migratie")).toBe("Task document");
	});
});
