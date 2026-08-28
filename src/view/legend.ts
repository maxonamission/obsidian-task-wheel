import { nodeColour, PRIORITY_LADDER } from "../layout/colour";
import type { WheelLayout } from "../layout/radial";

/**
 * The key to the two colour channels.
 *
 * Without it the second channel is invisible: a reader can see that two dots
 * differ in lightness but not that the difference means priority. Hue needs no
 * key here — the wheel writes each domain's name on its own rim, in the colour
 * it is drawn in.
 */
export function renderLegend(
	parent: HTMLElement,
	layout: WheelLayout,
	filter?: { text: string; shown: number; left: number },
): void {
	parent.empty();
	if (layout.budgets.length === 0) return;

	// A filter is the one thing here that changes what the wheel is *about*, so
	// it goes first and it says its own numbers. The wheel may leave work out;
	// it may not leave it out quietly (kaderdocument §3.3).
	if (filter !== undefined) {
		const line = parent.createDiv({ cls: "task-wheel-filter" });
		line.createSpan({ cls: "task-wheel-filter-label", text: "Filter" });
		line.createSpan({ cls: "task-wheel-filter-rule", text: filter.text });
		line.createSpan({
			cls: "task-wheel-filter-count",
			text: `${filter.shown} in this round · ${filter.left} left out`,
		});
	}

	// No list of domains: the wheel writes their names on its own rim, in the
	// colour they are drawn in. Repeating them here cost five lines of a phone
	// screen to say what the drawing already says in place.
	const ramp = parent.createDiv({ cls: "task-wheel-legend-ramp" });
	ramp.createSpan({ cls: "task-wheel-legend-caption", text: "Priority" });

	const scale = ramp.createSpan({ cls: "task-wheel-legend-scale" });
	for (const priority of PRIORITY_LADDER) {
		const step = scale.createSpan({
			cls: "task-wheel-legend-step",
			attr: { "aria-label": priority, title: priority },
		});
		// The ramp is drawn in the first domain's hue: it is the lightness that
		// carries the meaning, not the colour it happens to be shown in.
		step.style.setProperty(
			"--tw-colour",
			nodeColour(0, priority, layout.palette),
		);
	}

	ramp.createSpan({
		cls: "task-wheel-legend-caption",
		text: "highest → lowest",
	});

	// There was one more line here: "drag or scroll to turn · arrows walk the
	// tree · tap to go there". It was a stopgap — the wheel offers no visible
	// handle, so how to work it had to be said somewhere, and four clauses
	// wrapped to three lines on a phone and hid behind the navigation bar. The
	// help panel says all of it properly now, so the stopgap went with it
	// (kaderdocument §5.2, besluit 3). What stays here is the key that has to be
	// readable without opening anything.
}
