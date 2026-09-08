import { describe as group, expect, it } from "vitest";
import { buildTree } from "../parse/build-tree";
import { isRefused, scopeFor } from "../model/scope";
import {
	DEFAULT_PARSE_OPTIONS,
	scopeKey,
	scopeLabel,
	VAULT_SCOPE,
	type NoteInput,
	type ParseOptions,
	type WheelNode,
	type WheelScope,
} from "../model/types";

/**
 * Stepping into the fallback wedge (BC_E3_S157, audit 6 sep 2026).
 *
 * In heading mode a task under no heading lands in the fallback domain, so that
 * wedge holds two kinds of work at once: whatever heading happens to carry the
 * fallback's name, and everything loose. The step in showed only the first, and
 * where there was no such heading — the ordinary case — that was an empty wheel
 * with nothing said about the items the reader had just been looking at.
 *
 * Measured before: wedge *Overig* with two items, stepping in gave 0 shown and
 * 0 filtered out. The count is the point: 0 and 0 together mean the wheel is not
 * even claiming to have left anything out, which is the silence §3.3 forbids.
 */

const NOTES: NoteInput[] = [
	{
		path: "Werk/Plan.md",
		content: [
			"- [ ] Losse taak boven de eerste kop",
			"- [ ] Nog een losse",
			"",
			"## Deze week",
			"- [ ] Onder de kop",
		].join("\n"),
	},
	{
		path: "Thuis/Zonder koppen.md",
		content: "- [ ] Een notitie zonder enige kop",
	},
];

const HEADING_MODE: ParseOptions = {
	...DEFAULT_PARSE_OPTIONS,
	domainSource: "heading",
	scope: VAULT_SCOPE,
};

const FALLBACK = DEFAULT_PARSE_OPTIONS.fallbackDomain;

function wedge(label: string): WheelNode {
	const found = buildTree(NOTES, HEADING_MODE).root.children.find(
		(child) => child.label === label,
	);
	if (found === undefined) throw new Error(`no wedge called ${label}`);
	return found;
}

/** The wheel a wedge opens, refusing to carry a refusal any further. */
function stepInto(node: Pick<WheelNode, "kind" | "label" | "source">): WheelScope {
	const answer = scopeFor(
		{ kind: node.kind, depth: 1, label: node.label, source: node.source },
		VAULT_SCOPE,
		"heading",
		FALLBACK,
	);
	if (isRefused(answer)) throw new Error(`stepping into ${node.label} was refused`);
	return answer;
}

group("the fallback wedge in heading mode", () => {
	it("holds the work that stands under no heading", () => {
		expect(wedge(FALLBACK).shownTaskCount).toBe(3);
	});

	it("opens on exactly what it was drawing", () => {
		const scope = stepInto(wedge(FALLBACK));
		expect(scope).toEqual({ kind: "heading", heading: FALLBACK, path: "", loose: true });

		const inside = buildTree(NOTES, { ...HEADING_MODE, scope });
		expect(inside.root.shownTaskCount).toBe(3);
		expect(inside.filteredOut).toBe(0);
	});

	it("leaves a named heading wedge exactly as it was", () => {
		const scope = stepInto(wedge("Deze week"));
		expect(scope).toEqual({ kind: "heading", heading: "Deze week", path: "", loose: false });

		const inside = buildTree(NOTES, { ...HEADING_MODE, scope });
		expect(inside.root.shownTaskCount).toBe(1);
	});

	/**
	 * The corner the name comparison is accused of getting wrong, measured.
	 *
	 * Where a heading really is called *Overig*, the tree already draws its work
	 * and the loose work as one wedge — there is no second wedge to tell apart.
	 * So a wheel holding both is not an approximation: it is the wedge.
	 */
	it("carries both halves when a real heading shares the fallback's name", () => {
		const notes: NoteInput[] = [
			{
				path: "Werk/Plan.md",
				content: ["- [ ] Los", "", `## ${FALLBACK}`, "- [ ] Onder de kop"].join("\n"),
			},
		];
		const tree = buildTree(notes, HEADING_MODE);
		const bucket = tree.root.children.find((child) => child.label === FALLBACK);
		expect(bucket?.shownTaskCount).toBe(2);

		const scope = stepInto({ kind: "domain", label: FALLBACK });
		const inside = buildTree(notes, { ...HEADING_MODE, scope });
		expect(inside.root.shownTaskCount).toBe(2);
	});

	it("is a wheel of its own, and says what it holds", () => {
		const loose = { kind: "heading", heading: FALLBACK, path: "", loose: true } as const;
		const named = { kind: "heading", heading: FALLBACK, path: "" } as const;

		// Its own round: the two are different wheels and may not share marks.
		expect(scopeKey(loose)).not.toBe(scopeKey(named));
		expect(scopeLabel(loose)).toBe(`${FALLBACK} and loose work`);
		expect(scopeLabel(named)).toBe(FALLBACK);
	});

	/**
	 * A caller that names no fallback gets no loose bucket.
	 *
	 * The default keeps every other call site honest rather than quietly
	 * turning some wedge into the bucket because its label happened to match an
	 * empty string.
	 */
	it("makes no bucket when nobody says which wedge is the fallback", () => {
		const scope = scopeFor({ kind: "domain", depth: 1, label: FALLBACK }, VAULT_SCOPE, "heading");
		expect(scope).toEqual({ kind: "heading", heading: FALLBACK, path: "", loose: false });
	});
});
