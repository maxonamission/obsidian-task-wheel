/**
 * The search box, as a small query language.
 *
 * Three things it does, and nothing more:
 *
 *  - **Words are ANDed.** `knsb rapport` wants both, in any order.
 *  - **`OR` (or `|`) offers an alternative.** `knsb OR nocnsf` wants either.
 *  - **Quotes hold a phrase together.** `"jaarplan 2027"` is one thing to find,
 *    in that order, and exactly as written.
 *  - **`file:` looks at the note instead of the task.** `file:jaarplan` finds
 *    the tasks in every note whose name says jaarplan; `bellen file:jaarplan`
 *    wants both at once.
 *  - **A `*` stands for any run of characters**, the same as in the skip lists.
 *    A bare word already matches part of a word, so the star earns its keep in
 *    the middle: `week*verslag`. Inside quotes it is an ordinary character.
 *
 * That last one is Obsidian's own idiom, and it is an operator rather than part
 * of the default on purpose. A bare word searches the task and nothing else, so
 * `plan` cannot quietly drag in everything that happens to live in *Plan.md*.
 * Reaching into the note around the task is a thing you ask for.
 *
 * `OR` is recognised in capitals only. Lowercase "or" is an ordinary word in
 * both languages this vault is written in, and a search box that quietly turns
 * a word you typed into an operator is worse than one that makes you shout it.
 *
 * Everything else is a bare word, and a bare word is allowed to be typed
 * badly: it matches as a part of a word, and failing that within a small edit
 * distance, so `loodgeiter` still finds the plumber. A phrase in quotes does
 * not get that latitude — quoting is how you say "I mean exactly this".
 *
 * Deliberately no parentheses and no NOT. Tags already have their own
 * include/exclude lists, and a filter box that grows a grammar is a filter box
 * nobody can read back a week later.
 */

/** What a term is aimed at. `file` is written `file:` in the box. */
export type Field = "task" | "file";

import { globMatches, isBlankPattern, isPattern } from "./glob";

export interface Term {
	text: string;
	/** Quoted: matched literally, never fuzzily. */
	phrase: boolean;
	field: Field;
}

/** The two things a query can be aimed at, for one task. */
export interface Haystack {
	/** The task's own description and its tags. */
	task: string;
	/** The name of the note the task sits in. */
	file: string;
}

/** Terms that must all match. */
export type Group = Term[];

/** Groups of which at least one must match. */
export type Query = Group[];

/** How far a word may be off before it stops counting, by term length. */
function tolerance(length: number): number {
	if (length <= 3) return 0;
	if (length <= 7) return 1;
	return 2;
}

/**
 * Read the box.
 *
 * Never throws and never rejects: half-typed input is the normal state of a
 * search field. An unclosed quote simply runs to the end, and a trailing `OR`
 * is dropped.
 */
export function parseQuery(text: string): Query {
	const groups: Query = [];
	let group: Group = [];

	for (const token of tokenise(text)) {
		if (token.operator) {
			// `a OR OR b` and a leading `OR` are typos, not a reason to complain.
			if (group.length > 0) groups.push(group);
			group = [];
			continue;
		}
		group.push({
			text: token.text.toLowerCase(),
			phrase: token.phrase,
			field: token.field,
		});
	}

	if (group.length > 0) groups.push(group);
	return groups;
}

/** Whether the query asks for anything at all. */
export function isEmpty(query: Query): boolean {
	return query.every((group) => group.length === 0);
}

/** The query written back out, so the wheel can say what it is looking for. */
export function describeQuery(query: Query): string {
	return query
		.filter((group) => group.length > 0)
		.map((group) => group.map(describeTerm).join(" "))
		.join(" OR ");
}

function describeTerm(term: Term): string {
	const prefix = term.field === "file" ? "file:" : "";
	return term.phrase ? `${prefix}"${term.text}"` : `${prefix}${term.text}`;
}

/**
 * Whether a haystack answers the query.
 *
 * One group is enough; within a group every term has to land — and each term
 * lands in the half of the haystack it is aimed at.
 */
export function matchesQuery(query: Query, haystack: Haystack): boolean {
	if (isEmpty(query)) return true;

	// Split once per side rather than per term: this runs over every task in the
	// vault, and most queries hold more terms than there are sides.
	const sides: Record<Field, Bag> = {
		task: bag(haystack.task),
		file: bag(haystack.file),
	};

	return query.some(
		(group) =>
			group.length > 0 &&
			group.every((term) => matchesTerm(term, sides[term.field])),
	);
}

interface Bag {
	text: string;
	words: string[];
}

function bag(haystack: string): Bag {
	const text = haystack.toLowerCase();
	return {
		text,
		words: text.split(/[^\p{L}\p{N}_/-]+/u).filter((word) => word.length > 0),
	};
}

function matchesTerm(term: Term, { text, words }: Bag): boolean {
	if (term.text.length === 0) return true;

	// A star means the same here as it does in the skip lists: any run of
	// characters. Bare words have always matched part of a word, so the pattern
	// is loose at both ends too — `accepta*` and `accepta` agree, and `a*b` is
	// the one that says something new. No typo latitude on top of a pattern:
	// writing one is saying what you mean.
	if (!term.phrase && isPattern(term.text)) {
		return globMatches(text, `*${term.text}*`);
	}

	if (text.includes(term.text)) return true;
	if (term.phrase) return false;

	const allowed = tolerance(term.text.length);
	if (allowed === 0) return false;

	return words.some((word) => within(term.text, word, allowed));
}

/**
 * Whether two words are within `allowed` edits of each other.
 *
 * Damerau-Levenshtein rather than plain Levenshtein: swapping two letters
 * counts as **one** edit, not two. That is not a refinement, it is the common
 * case — `afmakne` for `afmaken` is the typo people actually make, and under
 * plain Levenshtein a seven-letter word would have to be given two edits of
 * latitude to forgive it, which is enough slack to match half the vault.
 *
 * Three rows and an early exit: the smallest value in a row can only grow from
 * there, so a row that is already too far off ends it. That matters because
 * this runs over every word of every task.
 */
export function within(a: string, b: string, allowed: number): boolean {
	if (Math.abs(a.length - b.length) > allowed) return false;
	if (a === b) return true;

	let before = new Array<number>(b.length + 1);
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	let current = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		let best = i;

		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);

			// The two letters are each other's, the other way round.
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, before[j - 2] + 1);
			}

			current[j] = value;
			best = Math.min(best, value);
		}

		if (best > allowed) return false;
		[before, previous, current] = [previous, current, before];
	}

	return previous[b.length] <= allowed;
}

interface Token {
	text: string;
	phrase: boolean;
	operator: boolean;
	field: Field;
}

/** Written before a term to aim it at the note rather than the task. */
const FILE_PREFIX = "file:";

function tokenise(text: string): Token[] {
	const tokens: Token[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const ch = text[cursor];

		if (/\s/.test(ch)) {
			cursor += 1;
			continue;
		}

		// `file:` binds to whatever comes straight after it, quoted or not, so
		// `file:"jaarplan 2027"` is one phrase aimed at the note name.
		let field: Field = "task";
		if (text.slice(cursor).toLowerCase().startsWith(FILE_PREFIX)) {
			field = "file";
			cursor += FILE_PREFIX.length;
			// A bare `file:` with nothing behind it is somebody mid-sentence.
			if (cursor >= text.length || /\s/.test(text[cursor])) continue;
		}

		if (text[cursor] === '"') {
			const end = text.indexOf('"', cursor + 1);
			// An unclosed quote runs to the end of the box: somebody is still
			// typing, and refusing to search until they close it helps nobody.
			const stop = end < 0 ? text.length : end;
			const phrase = text.slice(cursor + 1, stop).trim();
			if (phrase.length > 0) {
				tokens.push({ text: phrase, phrase: true, operator: false, field });
			}
			cursor = stop + 1;
			continue;
		}

		let end = cursor;
		while (end < text.length && !/[\s"]/.test(text[end])) end += 1;

		const word = text.slice(cursor, end);
		cursor = end;

		if (field === "task" && (word === "OR" || word === "|")) {
			tokens.push({ text: word, phrase: false, operator: true, field });
		} else if (isBlankPattern(word)) {
			// Nothing but stars asks for everything, which is what an empty box
			// already does. Dropping it keeps the filter honestly off rather than
			// on and leaving nothing out. A literal star is still findable — in
			// quotes, where nothing is a pattern.
			continue;
		} else if (word.length > 0) {
			tokens.push({ text: word, phrase: false, operator: false, field });
		}
	}

	return tokens;
}
