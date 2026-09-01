/**
 * What a second tap on an item opens: the ladder of blikvelden, decided once.
 *
 * A second tap on the item already under the wedge says "and now show me
 * *this*" — the vault narrows to a folder, a folder to a note, a note to one of
 * its sections (kaderdocument §4.1, BC_E3_S64). Which of those an item stands
 * for depends on what the wheel is currently about, what kind of node it is,
 * and — for a wedge — where the domain comes from.
 *
 * It lives here, apart from the view, because it is a rule and not a drawing.
 * It grew a fourth case without anyone noticing: the wedge branch asked whether
 * the domain came from a tag, and answered "then it is a folder" for everything
 * else. When a third source arrived (a front-matter property, BC_E3_S81) a
 * wedge called `Work` started claiming to be a folder called `Work`, and the
 * wheel went looking for one (BC_E3_S92). A rule with three-and-counting
 * branches belongs somewhere a test can reach it.
 */

import type { DomainSource, NodeKind, SourceRef, WheelScope } from "./types";

/** The item a second tap landed on, as this decision needs it. */
export interface TappedNode {
	kind: NodeKind;
	/** Ring it sits on: one is the wedge, deeper is inside it. */
	depth: number;
	label: string;
	source?: SourceRef;
}

/**
 * Why there is no wheel to open — so the view can say which, in its own words.
 *
 * Never a bare `null`: a second tap that quietly does nothing is the failure
 * the wheel spends its whole design avoiding. Every refusal has a reason and
 * every reason has a sentence.
 */
export type NoScope =
	/** Tasks above the first heading: a bucket, not a section of the note. */
	| { refused: "no-section" }
	/** The domain is a tag or a property value, and neither is a folder. */
	| { refused: "not-a-folder"; source: DomainSource }
	/** Nothing on this item says where it came from. */
	| { refused: "no-source" };

export function scopeFor(
	node: TappedNode,
	within: WheelScope,
	domainSource: DomainSource,
): WheelScope | NoScope {
	const here = within.kind;

	// In a wheel over one note or one section the wedges and rings *are*
	// headings, so "a wheel over it" means the section. The source's heading
	// path is absolute, so the anchor is complete whatever depth this wheel
	// already sits at.
	if (
		(here === "note" || here === "section") &&
		(node.kind === "group" || (node.depth === 1 && node.kind === "domain"))
	) {
		const source = node.source;
		// A wedge without a heading line is the bucket for tasks above the first
		// heading — there is no section to open for that.
		if (source === undefined || source.raw === null) {
			return { refused: "no-section" };
		}
		return {
			kind: "section",
			path: source.path,
			heading: [...source.headingPath, node.label],
		};
	}

	// A wedge that is a note is handled below, by its source, like any other
	// note: in a folder wheel the outermost ring holds both (BC_E3_S35).
	if (node.depth === 1 && node.kind === "domain") {
		// Only a folder domain names a folder. A tag namespace and a
		// front-matter property both cut *across* the folders — that is what
		// they are for — so there is no folder of that name to open, and
		// pretending otherwise sends the wheel after one that is not there.
		if (domainSource !== "folder") {
			return { refused: "not-a-folder", source: domainSource };
		}

		// A domain's label is a folder name; under a folder wheel it is a name
		// inside that folder, so the path grows with the scope.
		const base = within.kind === "folder" ? `${within.path}/` : "";
		return { kind: "folder", path: `${base}${node.label}` };
	}

	const source = node.source;
	if (source === undefined) return { refused: "no-source" };
	return { kind: "note", path: source.path };
}

/** Whether the answer is a refusal rather than a wheel to open. */
export function isRefused(answer: WheelScope | NoScope): answer is NoScope {
	return "refused" in answer;
}
