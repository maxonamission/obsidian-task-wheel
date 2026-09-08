import { describe, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { titleHeadingOf } from "../parse/outline";
import {
	DEFAULT_PARSE_OPTIONS,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
} from "../model/types";

/**
 * A top heading that only repeats the note's name gets no ring (BC_E3_S70).
 *
 * The reason is measured, not aesthetic: in a folder where some notes open
 * with `# <name>` and some do not, the tasks land on two different rings, and
 * the outermost occupied ring appears to move in and out as you turn. The
 * owner reported that as a shifting outer ring on 27 aug 2026.
 */

function note(path: string, lines: string[]): NoteInput {
	return { path, content: lines.join("\n") };
}

function options(over: Partial<ParseOptions> = {}): ParseOptions {
	return { ...DEFAULT_PARSE_OPTIONS, ...over };
}

function tasksOf(root: WheelNode): WheelNode[] {
	const found: WheelNode[] = [];
	const walk = (node: WheelNode): void => {
		if (node.kind === "task") found.push(node);
		node.children.forEach(walk);
	};
	walk(root);
	return found;
}

function ringsOf(root: WheelNode): number[] {
	return [...new Set(tasksOf(root).map((task) => task.depth))].sort(
		(a, b) => a - b,
	);
}

describe("titleHeadingOf", () => {
	it("finds the heading that only says the note's name again", () => {
		expect(
			titleHeadingOf("Werk/Plan 2027.md", "# Plan 2027\n- [ ] Iets"),
		).toBe("Plan 2027");
	});

	it("ignores case and surrounding space, as a reader would", () => {
		expect(titleHeadingOf("Werk/Plan.md", "#   plan  \n- [ ] Iets")).toBe("plan");
	});

	it("keeps a heading that says more than the name", () => {
		expect(titleHeadingOf("Werk/Plan.md", "# Plan 2027\n- [ ] Iets")).toBe(null);
	});

	it("keeps both when the note has two top headings", () => {
		expect(
			titleHeadingOf("Werk/Plan.md", "# Plan\n- [ ] Iets\n# Bijlage\n- [ ] Nog iets"),
		).toBe(null);
	});

	it("reads the note's outermost level, whatever it is", () => {
		expect(titleHeadingOf("Werk/Plan.md", "## Plan\n- [ ] Iets")).toBe("Plan");
	});
});

describe("a folder of notes with and without a title heading", () => {
	const WITH = note("Werk/Met kop.md", [
		"# Met kop",
		"## Northwind",
		"- [ ] Roadmap lezen",
	]);
	const WITHOUT = note("Werk/Zonder kop.md", ["## Northwind", "- [ ] Bellen"]);

	it("puts every task on one and the same ring", () => {
		const tree = buildTree([WITH, WITHOUT], options());
		expect(ringsOf(tree.root)).toHaveLength(1);
	});

	it("still draws the headings below the title heading", () => {
		const tree = buildTree([WITH], options());
		const headings = [...tree.byId.values()].filter(
			(node) => node.kind === "group",
		);
		expect(headings.map((node) => node.label)).toEqual(["Northwind"]);
	});

	it("leaves the ring in place when the heading says something of its own", () => {
		const other = note("Werk/Met kop.md", [
			"# Met kop en meer",
			"## Northwind",
			"- [ ] Roadmap lezen",
		]);
		const tree = buildTree([other, WITHOUT], options());
		expect(ringsOf(tree.root)).toHaveLength(2);
	});

	it("keeps a task's own heading line, so an edit still lands right", () => {
		const tree = buildTree([WITH], options());
		const task = tasksOf(tree.root)[0];
		expect(task.source?.line).toBe(2);
	});
});

describe("a section wheel inside a note with a title heading", () => {
	const NOTE = note("Werk/Plan.md", [
		"# Plan",
		"## Northwind",
		"- [ ] Roadmap lezen",
		"## Eastgate",
		"- [ ] Bellen",
	]);

	it("anchors on the path the wheel shows, and does not call it missing", () => {
		const tree = buildTree(
			[NOTE],
			options({ scope: { kind: "section", path: NOTE.path, heading: ["Northwind"] } }),
		);
		expect(tree.sectionMissing).toBe(false);
		expect(tasksOf(tree.root).map((task) => task.label)).toEqual([
			"Roadmap lezen",
		]);
	});

	it("still knows when the section really is gone", () => {
		const tree = buildTree(
			[NOTE],
			options({ scope: { kind: "section", path: NOTE.path, heading: ["NSF"] } }),
		);
		expect(tree.sectionMissing).toBe(true);
	});
});
