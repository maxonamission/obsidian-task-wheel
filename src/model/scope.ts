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

/**
 * Whether this item is a task that *is* a whole note (BC_E3_S130).
 *
 * One question asked in four places — what a rename refuses, what activating
 * says, what may be carried, and where a step out lands — so it is answered
 * once. Both halves are needed: `raw === null` alone also fits a heading whose
 * own line was never found, and a note ring is a whole note without being a
 * task.
 */
export function isNoteTask(node: {
	kind: NodeKind;
	source?: SourceRef;
}): boolean {
	return node.kind === "task" && node.source?.raw === null;
}

/**
 * What activating an item opens: its inside, or itself.
 *
 * A folder, a note, a heading and the root all *contain* something, so opening
 * one means a wheel over it — the ladder `scopeFor` below works out. A task
 * contains nothing. Opening a task used to mean a wheel over the note it lives
 * in, which is not the task, and inside a wheel over that note already it was a
 * key that answered "this wheel is already about that" and did nothing else
 * (eigenaar, 2 sep 2026). So a task opens for editing.
 *
 * A rule of one line, kept here rather than in the view for the reason the
 * whole module exists: it is a rule, not a drawing, and adding a sixth kind
 * should make a test ask what it opens.
 */
export function activates(kind: NodeKind): "edit" | "wheel" {
	return kind === "task" ? "edit" : "wheel";
}

/**
 * Why the card's title cannot be rewritten here — so the view can say which.
 *
 * The same rule as `NoScope` above, one act further along: a tap on the title
 * of a task opens its editor, and a tap on anything else did nothing at all
 * (eigenaar, 2 sep 2026, on a phone, where "nothing happened" and "the tap
 * missed" look identical). Every refusal has a reason and every reason has a
 * sentence — and where there is somewhere else to do it, the sentence says so
 * rather than only saying no.
 *
 * Three left of the five, and that is the whole of BC_E3_S119. A heading and a
 * note both *have* a name worth changing from the card, so both now do —
 * a heading by rewriting its own line, a note through `fileManager.renameFile`
 * so the links follow. What is left is permanent: a folder is file management,
 * and a tag or a property wedge is a name that is written down nowhere at all.
 */
export type NoRename =
	/** A wedge standing for a folder. */
	| { refused: "folder" }
	/** A wedge standing for a tag or a property value: written down nowhere. */
	| { refused: "wedge"; source: DomainSource }
	/** Anything else with no name of its own. */
	| { refused: "nameless" };

/**
 * What a wedge is made of, in words (BC_E3_S172).
 *
 * Two refusals name this — the one about renaming and the one about opening —
 * and both used to end in a silent `else`: anything that was not a tag or a
 * heading was called a note property. Today that is true, because a folder
 * wedge is refused a step earlier; a fifth domain source would have been called
 * a note property without a word said. A `switch` over the union makes that a
 * compile error instead (audit 6 sep 2026).
 *
 * The noun phrase only. What it *means* — no name to rewrite, no folder to open
 * — is each refusal's own sentence, because they are answering different
 * questions about the same wedge.
 */
export function wedgeSource(source: DomainSource): string {
	switch (source) {
		case "folder":
			return "a folder";
		case "tag":
			return "a tag";
		case "property":
			return "a note property";
		case "heading":
			return "a heading in several notes at once";
	}
}

/**
 * What an item *is*, in one word (BC_E3_S68).
 *
 * The wheel puts a folder, a note, a heading, a task and a subtask on the same
 * kind of dot, and on one ring they stand side by side. That is the price of a
 * drawing where the ring means depth rather than kind, and it is the right
 * price: the alternative was a ring per kind, which the kaderdocument turned
 * down for good reasons. But the reader could not read *what* something was
 * anywhere at all, and the card is the cheapest place to say it out loud
 * (owner, 27 aug 2026, confirmed 9 sep 2026).
 *
 * Two shapes of node need more than their `kind` to answer:
 *
 *  - A **wedge** is a folder only when the domain comes from one. With a tag or
 *    a front-matter property it is a name that lives nowhere on disk, and
 *    calling it a folder is the very mistake BC_E3_S92 came from. The four
 *    sources are switched over rather than defaulted, for the reason
 *    `wedgeSource` gives just above.
 *  - A **task** is three different things. `raw === null` is a whole note
 *    (`isNoteTask`), a task under another task is a subtask, and the rest are
 *    tasks. The first of those also fixes a small untruth on the card: a task
 *    document has no line, and the card used to say *line 1* about it.
 *
 * English, like the rest of the plugin's own interface. The card reads no
 * translation catalogue, so this costs none.
 */
export function kindWord(
	// Narrower than `TappedNode` on purpose: naming a thing needs no ring and no
	// label, and asking for them would make every caller find two values it does
	// not use.
	node: { kind: NodeKind; source?: SourceRef },
	/** The kind of the node one ring in, or `null` at the hub. */
	parentKind: NodeKind | null,
	domainSource: DomainSource,
): string {
	switch (node.kind) {
		case "root":
			return "Vault";
		case "domain":
			return wedgeWord(domainSource);
		case "project":
			return "Note";
		case "group":
			return "Heading";
		case "task":
			if (isNoteTask(node)) return "Task document";
			return parentKind === "task" ? "Subtask" : "Task";
	}
}

/**
 * The wedge's own word. `wedgeSource` says the same thing as a noun phrase
 * inside a sentence ("this wedge is a tag"); this is the label on a line of
 * fields, so it is capitalised and bare.
 */
function wedgeWord(source: DomainSource): string {
	switch (source) {
		case "folder":
			return "Folder";
		case "tag":
			return "Tag";
		case "property":
			return "Note property";
		case "heading":
			return "Heading";
	}
}

export function renameRefusal(
	node: TappedNode,
	within: WheelScope,
	domainSource: DomainSource,
): NoRename {
	// A heading, a note ring and a task document all rename from the card now
	// (BC_E3_S119), so none of them reaches this function any more: `actionsFor`
	// hands each of them a `rename` and never an `onTitleRefused`. What is left
	// here are the two kinds with no name written down anywhere, and everything
	// that has no name at all.

	if (node.kind === "domain" && node.depth === 1) {
		// In a wheel over one note the top ring *is* headings — the same branch
		// `scopeFor` takes, for the same reason. Those rename like any other
		// heading, so there is nothing to refuse.
		if (within.kind === "note" || within.kind === "section") {
			return { refused: "nameless" };
		}
		// On a folder wheel the wedge *is* a subfolder whatever the domain
		// source says — `resolveWedge` puts the scope before the setting there
		// ("a folder wheel asks about folders"). Asking the setting instead told
		// the reader "this wedge comes from a tag" about a folder on disk
		// (found by audit, 6 sep 2026).
		return domainSource === "folder" || within.kind === "folder"
			? { refused: "folder" }
			: { refused: "wedge", source: domainSource };
	}

	return { refused: "nameless" };
}

/**
 * The note this wheel is about, if it is about one (BC_E3_S172).
 *
 * A note wheel and a section wheel are both about one file — a section is a
 * part of one — so both offer a way into it. Two places asked this and gave two
 * answers: the header action counted a section wheel, the button in the corner
 * did not, so on a section wheel the reader was offered the note above the pane
 * and not beside the drawing (audit 6 sep 2026).
 *
 * `null` for the three that are about no single file: the vault, a folder, and
 * a heading wheel, which is one name across many notes.
 */
export function noteOf(scope: WheelScope): string | null {
	return scope.kind === "note" || scope.kind === "section" ? scope.path : null;
}

export function scopeFor(
	node: TappedNode,
	within: WheelScope,
	domainSource: DomainSource,
	/**
	 * What the fallback wedge is called, so a step into it can carry the loose
	 * work along (BC_E3_S157).
	 *
	 * A name rather than a flag on the node, because the name is all the tree
	 * has: a fallback wedge and a heading wedge are the same shape, both without
	 * a source of their own. That is not a loss of precision — where a heading
	 * really is called *Overig*, its work and the loose work are already drawn
	 * as one wedge, so one wheel holding both is the honest answer and not an
	 * approximation of two.
	 *
	 * Empty by default: a caller that does not say has no fallback wedge, and no
	 * label is ever empty, so nothing matches by accident.
	 */
	fallbackDomain = "",
): WheelScope | NoScope {
	const here = within.kind;

	// A heading is a section, wherever you happen to be standing when you open
	// it. The source's heading path is absolute, so the anchor is complete
	// whatever depth this wheel already sits at.
	//
	// This used to be conditioned on the wheel already being over a note or a
	// section, and in a vault or folder wheel a heading therefore fell through
	// to the note-by-source case at the bottom: opening an `# H1` gave you the
	// whole note instead of that section, silently skipping a rung of the
	// ladder (eigenaar, 2 sep 2026). A heading is the same thing in every
	// wheel; only the *wedge* case below depends on where you are.
	if (node.kind === "group") {
		const source = node.source;
		if (source !== undefined) {
			return {
				kind: "section",
				path: source.path,
				heading: [...source.headingPath, node.label],
			};
		}
		// A heading whose own line was never found anchors nothing. It falls
		// through to the no-source refusal at the bottom, which says just that
		// — rather than to "above the first heading", which would be a sentence
		// about a different thing.
	}

	// In a wheel over one note or one section the top ring *is* headings, so a
	// wedge there means the section it names.
	if ((here === "note" || here === "section") && node.depth === 1 && node.kind === "domain") {
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
		// A heading wedge opens a wheel over that heading, wherever it is
		// written (BC_E3_S146). It was the one wedge with no way in: not a
		// folder and not a note, so the ladder stopped at exactly the axis the
		// reader had just chosen — *"ik kan nu alleen uitzoomen"* (eigenaar,
		// 5 sep 2026). It keeps to the folder it was opened from, so stepping in
		// never quietly widens the view back out to the whole vault.
		if (domainSource === "heading") {
			return {
				kind: "heading",
				heading: node.label,
				path: within.kind === "folder" ? within.path : "",
				// The fallback wedge holds whatever heading carries its name
				// *and* everything under no heading at all. Stepping in shows
				// both, which is what the wedge was drawing (BC_E3_S157).
				loose: fallbackDomain.length > 0 && node.label === fallbackDomain,
			};
		}

		// Only a folder domain names a folder. A tag namespace and a
		// front-matter property both cut *across* the folders — that is what
		// they are for — so there is no folder of that name to open, and
		// pretending otherwise sends the wheel after one that is not there.
		//
		// Except on a folder wheel, where the wedge is a subfolder no matter
		// which source is set: `resolveWedge` decides that with the scope, not
		// with the setting. Refusing here stopped the ladder on the very wedge
		// the reader had just chosen, with a sentence that was untrue there
		// (found by audit, 6 sep 2026).
		if (domainSource !== "folder" && within.kind !== "folder") {
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
