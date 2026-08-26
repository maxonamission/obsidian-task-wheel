import { VAULT_SCOPE, type WheelScope } from "../model/types";

/**
 * What the wheel that opens with the vault is about.
 *
 * The startup wheel began as the vault wheel and nothing else (BC_E3_S34). That
 * is the wrong default for the way the owner works: the review that opens the
 * day is usually over *one* folder or *one* note — the week's list, the project
 * in hand — and a wheel over five thousand tasks is the one you close again
 * (eigenaar, 22 aug 2026).
 *
 * A path is typed, so it has to be read charitably and answered honestly. Both
 * halves are here, away from the vault, because "what did they mean" is the
 * part with rules in it and "is it there" is a single lookup.
 */

/** What the vault holds at a path, as far as this decision cares. */
export type Found = "folder" | "note" | null;

export type StartScope =
	/** Open a wheel over this. */
	| { scope: WheelScope }
	/** Nothing of that name is in the vault; the caller says so. */
	| { missing: string };

/**
 * The scope a typed path asks for.
 *
 * Empty means the whole vault — the setting is one field, and leaving it blank
 * is the plainest way to say "everything". A note may be named with or without
 * its extension: everywhere else in Obsidian a note is called `Werk/Plan`, and
 * insisting on `.md` here would be this one box having its own rules.
 */
export function startScope(
	typed: string,
	look: (path: string) => Found,
): StartScope {
	const path = typed.trim().replace(/^\/+|\/+$/g, "");
	if (path.length === 0) return { scope: VAULT_SCOPE };

	const found = look(path);
	if (found === "folder") return { scope: { kind: "folder", path } };
	if (found === "note") return { scope: { kind: "note", path } };

	const named = `${path}.md`;
	if (look(named) === "note") return { scope: { kind: "note", path: named } };

	// Deliberately not "so we opened the vault instead" as if that were the same
	// thing. A path that is gone — renamed, deleted — is a fact the reader has
	// to hear, or the wheel silently reviews something else than they asked for.
	return { missing: path };
}
