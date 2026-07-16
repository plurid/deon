// The position adapter between Deon and the Language Server Protocol.
//
// Deon measures a position as a 1-based line and a 1-based **code-point** column (the unit a reader
// calls one character — a `😀` is one). The LSP measures it as a 0-based line and a 0-based
// **UTF-16 code-unit** character (that same `😀` is two, a surrogate pair), which is also exactly how
// a JavaScript string is indexed. This module converts between the two, in both directions, so an
// underline lands on the character the reader means and a click resolves the token under the cursor.
//
// Line numbering is shared: Deon folds CRLF to LF before it counts, and a CR sits only at a line's
// end, so it never shifts a column measured from the line's start. The line array is therefore built
// over the document's own text, CRLF and all, and the two agree on every position within a line.

// #region module
export interface LspPosition {
    line: number;
    character: number;
}

export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}

/**
 * A Deon range as a diagnostic carries it: 1-based line and code-point column, at each end.
 */
export interface DeonRange {
    start: { line: number; column: number };
    end: { line: number; column: number };
}


const LINE_FEED = 10;


/**
 * The UTF-16 index at which each line begins. Index `n` is the start of line `n` (0-based); a
 * document always has at least line 0, starting at 0.
 */
export const lineStarts = (
    text: string,
): number[] => {
    const starts = [0];
    for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === LINE_FEED) {
            starts.push(index + 1);
        }
    }
    return starts;
};


/**
 * Deon (1-based line, 1-based code-point column) to LSP (0-based line, 0-based UTF-16 character).
 * Walks the column's worth of code points from the line's start, summing the UTF-16 units each one
 * costs, and stops at a line feed so a column past the line's end clamps to the end rather than
 * bleeding into the next line.
 */
export const toLspPosition = (
    text: string,
    starts: number[],
    line: number,
    column: number,
): LspPosition => {
    const lineIndex = Math.max(0, Math.min(line - 1, starts.length - 1));
    const from = starts[lineIndex];

    let index = from;
    let reached = 1;
    while (reached < column && index < text.length) {
        const code = text.codePointAt(index)!;
        if (code === LINE_FEED) {
            break;
        }
        index += code > 0xffff ? 2 : 1;
        reached += 1;
    }

    return { line: lineIndex, character: index - from };
};


export const toLspRange = (
    text: string,
    starts: number[],
    range: DeonRange,
): LspRange => ({
    start: toLspPosition(text, starts, range.start.line, range.start.column),
    end: toLspPosition(text, starts, range.end.line, range.end.column),
});


/**
 * LSP (0-based line, 0-based UTF-16 character) back to Deon (1-based line, 1-based code-point
 * column) — the inverse, used to turn the cursor into a position the syntax tree is measured in, so
 * a hover or a definition can find the token the cursor sits on.
 */
export const toDeonPosition = (
    text: string,
    starts: number[],
    position: LspPosition,
): { line: number; column: number } => {
    const lineIndex = Math.max(0, Math.min(position.line, starts.length - 1));
    const from = starts[lineIndex];
    const target = from + position.character;

    let index = from;
    let column = 1;
    while (index < target && index < text.length) {
        const code = text.codePointAt(index)!;
        if (code === LINE_FEED) {
            break;
        }
        index += code > 0xffff ? 2 : 1;
        column += 1;
    }

    return { line: lineIndex + 1, column };
};


/**
 * Whether a Deon position `(line, column)` falls within the half-open span `[start, end)` of a token,
 * both measured in Deon's line/column. Lexicographic on `(line, column)`.
 */
export const withinSpan = (
    line: number,
    column: number,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
): boolean => {
    const afterStart = line > startLine || (line === startLine && column >= startColumn);
    const beforeEnd = line < endLine || (line === endLine && column < endColumn);
    return afterStart && beforeEnd;
};
// #endregion module
