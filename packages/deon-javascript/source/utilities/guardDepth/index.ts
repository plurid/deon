// #region imports
    // #region external
    import {
        DiagnosticCode,
        resourceError,
    } from '../../objects/Diagnostic';

    import {
        MAX_DEPTH,
    } from '../../objects/Parser';
    // #endregion external
// #endregion imports



// #region module
/**
 * The parser refuses a document that nests more deeply than it will follow, so that a hostile input
 * cannot exhaust the host stack and come back as a `RangeError` — an error with no code, no position,
 * and nothing a caller can do about it. A value built by hand and handed to the writers is data all
 * the same, and can nest just as deeply, so the writers have to refuse it on the same terms.
 *
 * The walk is iterative, on an explicit stack, precisely so that the guard cannot overflow while
 * checking whether something else would. Depth counts the values enclosing each one — the root has
 * none, so it is depth 0 — which is what the parser counts as it descends, so the two limits are the
 * same value and a caller is refused by both for the same reason. A value nested exactly at the limit
 * is accepted; only one nested past it is refused.
 */
const guardDepth = (
    root: unknown,
): void => {
    const stack: { value: unknown; depth: number }[] = [
        { value: root, depth: 0 },
    ];

    while (stack.length) {
        const { value, depth } = stack.pop() as { value: unknown; depth: number };

        if (depth > MAX_DEPTH) {
            resourceError(
                DiagnosticCode.PARSE_EXPECTED,
                'The value nests more deeply than the writer will follow.',
                '<value>',
            );
        }

        if (Array.isArray(value)) {
            for (const entry of value) {
                stack.push({ value: entry, depth: depth + 1 });
            }

            continue;
        }

        if (typeof value === 'object' && value !== null) {
            for (const entry of Object.values(value as Record<string, unknown>)) {
                stack.push({ value: entry, depth: depth + 1 });
            }
        }
    }
};
// #endregion module



// #region exports
export {
    guardDepth,
};
// #endregion exports
