/**
 * Which wheel the help panel is about.
 *
 * The panel lives beside the wheel, not inside it, so it has to answer that
 * question again every time the reader changes pane. Three rules, in order,
 * and the order is the decision (kaderdocument §5.2, besluit 1 en 2):
 *
 *  1. **A wheel that just became active is the subject.** With the vault wheel
 *     in one tab and a project wheel in the next, "the wheel" is the one in
 *     front of the reader — a panel reporting on the other one would describe a
 *     round they are not in, which is the lie harde eis §3.3 forbids.
 *  2. **Anything else leaves the subject alone.** Clicking a note is not
 *     another wheel; it is the detour every round has in it (§5.1), and the
 *     panel has no more business moving than the wheel does.
 *  3. **A wheel that is gone is no subject.** Closing the last wheel does not
 *     close the panel — the reader opened it, and often opens it *before* the
 *     wheel — so the answer is simply "none", and the round block says so.
 *
 * Deliberately the same shape as `openAround` in `resume.ts`: an id, what was
 * remembered, and a question about what is still there. Both are "where was I"
 * rules, and both are wrong in the same way if they trust a stale id.
 */
export function helpSubject(
	/** Key of the wheel that just became active, or `null` for any other pane. */
	activeKey: string | null,
	/** The wheel this panel was last about. */
	remembered: string | null,
	/** Whether a wheel with that key is still open. */
	stillOpen: (key: string) => boolean,
): string | null {
	if (activeKey !== null) return activeKey;
	if (remembered !== null && stillOpen(remembered)) return remembered;
	return null;
}
