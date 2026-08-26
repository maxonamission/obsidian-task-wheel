/**
 * Answering from a modal — once, late enough, and with the right answer.
 *
 * Every picker here is a promise around an Obsidian modal. Picking anything in
 * one of them did nothing at all on the desktop while working perfectly on
 * mobile, and it took three attempts to name why (owner, 17 aug 2026). Two
 * separate things had to be true, and the first two attempts each fixed one and
 * broke or missed the other:
 *
 *  1. **Obsidian does not agree with itself about the order.** On mobile the
 *     chooser runs and *then* the modal closes; on the desktop the modal closes
 *     **first** and the chooser runs after. Anything that reads the choice
 *     during `onClose` therefore reads it before there is one on the desktop —
 *     and answers `null`, which every caller treats as backing out. Hence
 *     `deliver` is a function: the answer is read when it is handed over, by
 *     which time the chooser has run under either order.
 *  2. **A modal that is still leaving owns the stack.** Carrying work into
 *     another note asks two modals in a row, and opening the second while the
 *     first is unwinding means the outgoing one takes the incoming one with it.
 *     Nothing is shown and nothing throws. So the hand-over waits for something
 *     observable rather than a guessed delay: this modal's element gone, and no
 *     `.modal-container` left anywhere.
 *
 * The lesson worth keeping is the shape of the bug rather than the fix: it
 * failed *silently*, on one platform only, and every wrong guess still looked
 * plausible. That is why the carry flow now writes a trace line at every step.
 *
 * A modal that answers must never resolve directly. It records what was chosen,
 * lets Obsidian close it, and calls this from `onClose` — including for backing
 * out, where the answer is `null` and a caller left awaiting for ever would be
 * a hung action.
 */

/** Longest we will wait for a modal to go before answering anyway. */
const GIVE_UP_MS = 1500;

export function handBack(
	/**
	 * What to answer with — read at delivery, never captured up front.
	 *
	 * This is the whole reason it is a function. Obsidian does not agree with
	 * itself about the order: on mobile the chooser runs and *then* the modal
	 * closes, on the desktop the modal closes **first** and the chooser runs
	 * after. Passing the chosen value in meant reading it during `onClose`,
	 * which on the desktop is before there is one — so every picker answered
	 * `null` a frame later and every action gave up without a word, whether it
	 * was a chain of two modals or a single one (owner, 17 aug 2026). Reading it
	 * at delivery is right under both orders, because delivery is always a frame
	 * away and the chooser has run by then.
	 */
	deliver: () => void,
	/** The modal's own container, so we can see this one go in particular. */
	el?: HTMLElement,
): void {
	const started = Date.now();

	// The modal's own document, not the plugin's. A tab torn off into its own
	// window has one of its own, and asking the main one whether a modal is open
	// there answers about the wrong screen (18 aug 2026).
	const doc = el?.ownerDocument ?? document;
	const frames = doc.defaultView ?? window;

	/**
	 * Two conditions, because the two orderings both happen.
	 *
	 * A modal whose element is detached *before* `onClose` runs would satisfy its
	 * own check straight away, so waiting on that alone is not enough — what the
	 * next modal actually needs is an empty stack, and `.modal-container` is that
	 * stack made visible. Waiting on both covers whichever way round Obsidian
	 * does it, on either platform, without guessing at a delay.
	 */
	const settled = (): boolean =>
		(el === undefined || !el.isConnected) &&
		doc.querySelector(".modal-container") === null;

	const look = (): void => {
		if (settled()) {
			deliver();
			return;
		}

		// Waited long enough that something else is holding a modal open.
		// Answering late is recoverable, never answering is a hung action — so we
		// answer, and say so. This branch is the one that would go wrong if an
		// Obsidian update changed the order again, and until now reaching it
		// looked exactly like reaching the other one (audit M4, 23 aug 2026).
		//
		// A console line rather than a Notice on purpose: the action does still
		// complete, so there is nothing here for the reader to do, and a warning
		// they cannot act on in the middle of a round is worse than none. Whoever
		// is diagnosing a wrong answer will find this.
		if (Date.now() - started > GIVE_UP_MS) {
			console.warn(
				`Task Wheel: a modal was still on the stack after ${GIVE_UP_MS} ms; answering anyway. If a picker gave the wrong answer, this is why.`,
			);
			deliver();
			return;
		}

		frames.requestAnimationFrame(look);
	};

	frames.requestAnimationFrame(look);
}
