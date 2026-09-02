import { describe, expect, it } from "vitest";
import {
	describeQuery,
	isEmpty,
	matchesQuery,
	parseQuery,
	within,
} from "../parse/query";

const HAY = "Northwind rapportage afmaken voor de bond werk/klant";

function finds(box: string, haystack = HAY, file = ""): boolean {
	return matchesQuery(parseQuery(box), { task: haystack, file });
}

describe("words are ANDed", () => {
	it("wants every word, in any order", () => {
		expect(finds("northwind rapportage")).toBe(true);
		expect(finds("rapportage northwind")).toBe(true);
		expect(finds("northwind offerte")).toBe(false);
	});

	it("ignores case on both sides", () => {
		expect(finds("Northwind")).toBe(true);
		expect(finds("northwind")).toBe(true);
	});

	it("matches part of a word", () => {
		expect(finds("rapport")).toBe(true);
	});

	it("lets an empty box through", () => {
		expect(finds("")).toBe(true);
		expect(finds("   ")).toBe(true);
		expect(isEmpty(parseQuery("  "))).toBe(true);
	});
});

describe("OR offers an alternative", () => {
	it("takes either side", () => {
		expect(finds("northwind OR eastgate")).toBe(true);
		expect(finds("eastgate OR northwind")).toBe(true);
		expect(finds("eastgate OR vwo")).toBe(false);
	});

	it("binds looser than the space, so each side may be several words", () => {
		expect(finds("northwind rapportage OR eastgate begroting")).toBe(true);
		// Neither side is complete on its own: the first word of each matches,
		// the second does not.
		expect(finds("northwind begroting OR eastgate rapportage")).toBe(false);
	});

	it("takes a pipe as well, for people who type it that way", () => {
		expect(finds("eastgate | northwind")).toBe(true);
	});

	it("only listens to capitals", () => {
		// "or" is an ordinary word; a box that turns it into an operator would be
		// searching for something the reader did not ask for.
		expect(parseQuery("northwind or eastgate")).toHaveLength(1);
		expect(parseQuery("northwind OR eastgate")).toHaveLength(2);
	});

	it("survives a typo in the query itself", () => {
		expect(finds("OR northwind")).toBe(true);
		expect(finds("northwind OR")).toBe(true);
		expect(finds("northwind OR OR eastgate")).toBe(true);
	});
});

describe("quotes hold a phrase together", () => {
	it("wants the words in that order", () => {
		expect(finds('"northwind rapportage"')).toBe(true);
		expect(finds('"rapportage northwind"')).toBe(false);
	});

	it("does not forgive a typo, because quoting means exactly this", () => {
		expect(finds('"northwind rapportagie"')).toBe(false);
		expect(finds("rapportagie")).toBe(true);
	});

	it("runs to the end when the quote is never closed", () => {
		// Half-typed input is the normal state of a search box.
		expect(finds('"northwind rapport')).toBe(true);
	});

	it("combines with the rest", () => {
		expect(finds('"northwind rapportage" bond')).toBe(true);
		expect(finds('"northwind rapportage" begroting')).toBe(false);
	});
});

describe("file: aims a term at the note instead of the task", () => {
	const NOTE = "Northwind roadmap 2027";

	it("looks in the note name, and only there", () => {
		expect(finds("file:roadmap", HAY, NOTE)).toBe(true);
		expect(finds("file:rapportage", HAY, NOTE)).toBe(false);
	});

	it("leaves the bare word aimed at the task, and only there", () => {
		expect(finds("rapportage", HAY, NOTE)).toBe(true);
		expect(finds("roadmap", HAY, NOTE)).toBe(false);
	});

	it("wants both when both are asked for", () => {
		expect(finds("rapportage file:roadmap", HAY, NOTE)).toBe(true);
		expect(finds("begroting file:roadmap", HAY, NOTE)).toBe(false);
		expect(finds("rapportage file:begroting", HAY, NOTE)).toBe(false);
	});

	it("binds to a quoted phrase behind it", () => {
		expect(finds('file:"northwind roadmap"', HAY, NOTE)).toBe(true);
		expect(finds('file:"roadmap northwind"', HAY, NOTE)).toBe(false);
	});

	it("stands on either side of an OR", () => {
		expect(finds("file:begroting OR file:roadmap", HAY, NOTE)).toBe(true);
		expect(finds("begroting OR file:roadmap", HAY, NOTE)).toBe(true);
		expect(finds("begroting OR file:offerte", HAY, NOTE)).toBe(false);
	});

	it("forgives a typo, like any other bare word", () => {
		expect(finds("file:raodmap", HAY, NOTE)).toBe(true);
	});

	it("is recognised however it is capitalised, unlike OR", () => {
		// OR has to shout because 'or' is an ordinary word; 'file:' cannot be
		// mistaken for one, so there is nothing to be strict about.
		expect(finds("FILE:roadmap", HAY, NOTE)).toBe(true);
		expect(finds("File:roadmap", HAY, NOTE)).toBe(true);
	});

	it("ignores itself when there is nothing behind it", () => {
		expect(isEmpty(parseQuery("file:"))).toBe(true);
		expect(isEmpty(parseQuery("file: roadmap"))).toBe(false);
		// ...and that trailing word is an ordinary one, not a note search.
		expect(finds("file: roadmap", HAY, NOTE)).toBe(false);
	});

	it("does not turn a word that merely contains it into an operator", () => {
		expect(finds("profile:x", HAY, NOTE)).toBe(false);
		expect(finds("profile", "een profile van de bond", NOTE)).toBe(true);
	});
});

describe("a star means the same here as in the skip lists", () => {
	// The plugin may not have one character meaning two things. In the settings
	// a '*' stands for any run of characters; in the search box it used to be a
	// literal asterisk, which quietly found every task carrying markdown bold.

	it("does not search for a literal asterisk", () => {
		expect(finds("*", "**Conclusie** afmaken")).toBe(true);
		expect(finds("*", "Loodgieter bellen")).toBe(true);
	});

	it("treats a box holding nothing but stars as empty", () => {
		expect(isEmpty(parseQuery("*"))).toBe(true);
		expect(isEmpty(parseQuery("***"))).toBe(true);
		expect(isEmpty(parseQuery(" * * "))).toBe(true);
	});

	it("agrees with the bare word it decorates", () => {
		expect(finds("rapport*")).toBe(true);
		expect(finds("*rapport")).toBe(true);
		expect(finds("*rapport*")).toBe(true);
		expect(finds("offerte*")).toBe(false);
	});

	it("earns its keep in the middle", () => {
		expect(finds("northwind*afmaken")).toBe(true);
		expect(finds("afmaken*northwind")).toBe(false);
	});

	it("says what it means, so it gets no typo latitude", () => {
		// 'rapportagie' finds the report; 'rapportagie*' asks for exactly that
		// stem and does not.
		expect(finds("rapportagie")).toBe(true);
		expect(finds("rapportagie*")).toBe(false);
	});

	it("still finds a real asterisk when you quote it", () => {
		expect(finds('"east*gate"', "afspraak met east*gate")).toBe(true);
		expect(finds('"east*gate"', "afspraak met eastgate")).toBe(false);
	});

	it("works behind file: as well", () => {
		expect(finds("file:road*map", HAY, "Northwind roadmap 2027")).toBe(true);
		expect(finds("file:map*road", HAY, "Northwind roadmap 2027")).toBe(false);
	});
});

describe("a bare word forgives a typo", () => {
	it("finds a word that was typed slightly wrong", () => {
		expect(finds("rapportagie")).toBe(true);
		expect(finds("rapportgae")).toBe(true);
	});

	it("keeps short words strict, where one letter is the whole meaning", () => {
		// A short word gets no latitude: with one edit allowed on three letters,
		// almost everything matches almost everything. Being *part* of a word
		// still counts, so "bon" finds "bond" — that is prefix matching, not
		// forgiveness.
		expect(finds("bon")).toBe(true);
		expect(finds("bnd")).toBe(false);
		expect(finds("bomd")).toBe(true);
	});

	it("forgives two letters that swapped places", () => {
		// The commonest typo of all, and plain Levenshtein charges two edits for
		// it — enough that a seven-letter word would need so much latitude that
		// it would match half the vault.
		expect(finds("afmakne")).toBe(true);
		expect(within("afmakne", "afmaken", 1)).toBe(true);
	});

	it("does not forgive so much that it finds anything", () => {
		expect(finds("begroting")).toBe(false);
		expect(finds("vergadering")).toBe(false);
	});

	it("still searches the tags", () => {
		expect(finds("klant")).toBe(true);
	});
});

describe("within", () => {
	it("counts the edits it takes to get from one word to the other", () => {
		expect(within("kat", "kat", 0)).toBe(true);
		expect(within("kat", "kot", 0)).toBe(false);
		expect(within("kat", "kot", 1)).toBe(true);
		expect(within("kat", "kots", 1)).toBe(false);
		expect(within("kat", "kots", 2)).toBe(true);
	});

	it("gives up early on lengths that cannot possibly meet", () => {
		expect(within("kat", "kattenbak", 2)).toBe(false);
	});

	it("handles the empty word without falling over", () => {
		expect(within("", "", 0)).toBe(true);
		expect(within("", "ab", 2)).toBe(true);
		expect(within("", "abc", 2)).toBe(false);
	});
});

describe("describeQuery", () => {
	it("writes the query back the way it was meant", () => {
		expect(describeQuery(parseQuery("northwind rapport"))).toBe("northwind rapport");
		expect(describeQuery(parseQuery("northwind OR eastgate"))).toBe("northwind OR eastgate");
		expect(describeQuery(parseQuery('"roadmap 2027" northwind'))).toBe(
			'"roadmap 2027" northwind',
		);
	});

	it("says a pipe as OR, so the line reads as words", () => {
		expect(describeQuery(parseQuery("a | b"))).toBe("a OR b");
	});
});
