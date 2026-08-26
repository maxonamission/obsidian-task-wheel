import { describe, expect, it } from "vitest";
import { hasLinks, plainText, splitLinks } from "../parse/links";
import { parseTaskLine } from "../parse/task-line";

/**
 * Links inside a task's own words.
 *
 * `Sportprogramma [[week-01]]` says half of what it is about in the link, and
 * showing that as four square brackets is showing it wrong.
 */

/** Just the links, for the cases where the plain text between is not the point. */
function links(text: string) {
	return splitLinks(text)
		.filter((piece) => piece.kind === "link")
		.map((piece) => (piece.kind === "link" ? piece : null));
}

describe("wiki links", () => {
	it("finds one in the middle of a sentence", () => {
		expect(splitLinks("Sportprogramma [[week-01]] afmaken")).toEqual([
			{ kind: "text", text: "Sportprogramma " },
			{ kind: "link", text: "week-01", target: "week-01", external: false },
			{ kind: "text", text: " afmaken" },
		]);
	});

	it("shows the alias and opens the target", () => {
		expect(links("Zie [[Werk/Plan 2027|het plan]]")[0]).toMatchObject({
			text: "het plan",
			target: "Werk/Plan 2027",
			external: false,
		});
	});

	it("keeps a heading on the target, where Obsidian wants it", () => {
		expect(links("[[Plan#Voorbereiding]]")[0]).toMatchObject({
			text: "Plan#Voorbereiding",
			target: "Plan#Voorbereiding",
		});
	});

	it("takes several in one line", () => {
		expect(links("[[a]] en [[b|B]]").map((link) => link?.target)).toEqual([
			"a",
			"b",
		]);
	});

	it("leaves an embed as it was written", () => {
		// The card cannot embed anything, and turning it into a link would open
		// something the reader asked to have shown in place.
		expect(splitLinks("![[plaatje.png]]")).toEqual([
			{ kind: "text", text: "![[plaatje.png]]" },
		]);
	});

	it("leaves a link that points at nothing alone", () => {
		expect(splitLinks("[[]]")).toEqual([{ kind: "text", text: "[[]]" }]);
		expect(splitLinks("[[|alias]]")).toEqual([
			{ kind: "text", text: "[[|alias]]" },
		]);
	});

	it("does not read an unclosed bracket as a link", () => {
		expect(hasLinks("Iets met [[ erin")).toBe(false);
	});
});

describe("markdown links and bare urls", () => {
	it("shows the label and opens the target", () => {
		expect(links("Lees [de gids](https://example.com/gids)")[0]).toMatchObject({
			text: "de gids",
			target: "https://example.com/gids",
			external: true,
		});
	});

	it("treats a path without a scheme as inside the vault", () => {
		expect(links("[het plan](Werk/Plan.md)")[0]).toMatchObject({
			target: "Werk/Plan.md",
			external: false,
		});
	});

	it("finds a url that was simply pasted in", () => {
		expect(splitLinks("Kijken op https://example.com vanavond")).toEqual([
			{ kind: "text", text: "Kijken op " },
			{
				kind: "link",
				text: "https://example.com",
				target: "https://example.com",
				external: true,
			},
			{ kind: "text", text: " vanavond" },
		]);
	});

	it("does not swallow the url of a markdown link a second time", () => {
		expect(links("[gids](https://example.com)")).toHaveLength(1);
	});

	it("leaves the sentence around it intact, punctuation and all", () => {
		const pieces = splitLinks("Zie [[plan]], en anders https://example.com.");
		expect(pieces.map((piece) => piece.text).join("")).toBe(
			"Zie plan, en anders https://example.com.",
		);
	});
});

describe("what the wheel already reads", () => {
	it("survives the parser, so the card sees the link as written", () => {
		// The description keeps the link; only the fields and tags are lifted out.
		const parsed = parseTaskLine("- [ ] Sportprogramma [[week-01]] 📅 2026-08-20");
		expect(parsed?.fields.description).toBe("Sportprogramma [[week-01]]");
		expect(links(parsed?.fields.description ?? "")[0]).toMatchObject({
			target: "week-01",
		});
	});

	it("says when there is nothing to follow", () => {
		expect(hasLinks("Loodgieter bellen")).toBe(false);
		expect(splitLinks("Loodgieter bellen")).toEqual([
			{ kind: "text", text: "Loodgieter bellen" },
		]);
	});

	it("is safe to call twice, which a redraw does constantly", () => {
		// A global regex keeps its own cursor; forgetting to reset it makes every
		// second call return something different.
		const once = splitLinks("[[a]] en [[b]]");
		expect(splitLinks("[[a]] en [[b]]")).toEqual(once);
	});
});

describe("plainText — the words without the syntax", () => {
	it("writes a wiki link as what it points at", () => {
		expect(plainText("Sportprogramma [[week-01]]")).toBe(
			"Sportprogramma week-01",
		);
	});

	it("prefers the alias, which is what the writer chose to say", () => {
		expect(plainText("Lezen [[2026-08-19|het dagboek]]")).toBe(
			"Lezen het dagboek",
		);
	});

	it("writes a markdown link as its label", () => {
		expect(plainText("Zie [de notulen](Werk/Notulen.md) na")).toBe(
			"Zie de notulen na",
		);
	});

	it("leaves a bare url as it is — that is what it says", () => {
		expect(plainText("Kijken https://example.org/a")).toBe(
			"Kijken https://example.org/a",
		);
	});

	it("leaves an embed alone, brackets and all", () => {
		// The card does not embed anything either: it is not a renderer.
		expect(plainText("Zie ![[plaatje.png]]")).toBe("Zie ![[plaatje.png]]");
	});

	it("closes the gap the syntax leaves behind", () => {
		expect(plainText("Bellen [[week-01]] daarna")).toBe("Bellen week-01 daarna");
		expect(plainText("[[a]] [[b]]")).toBe("a b");
	});

	it("hands back plain words untouched", () => {
		expect(plainText("Gewoon een taak")).toBe("Gewoon een taak");
	});
});
