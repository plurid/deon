// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import type {
        CallArgumentNode,
        CallNode,
        DeclarationNode,
        DocumentNode,
        LinkNode,
        ListNode,
        MapNode,
        Reference,
        StructureNode,
        ValueNode,
    } from '../../data/syntax';

    import {
        scalarNode,
    } from '../../data/syntax';

    import {
        deonError,
        DeonDiagnostic,
        DiagnosticCode,
    } from '../Diagnostic';

    import {
        decodeMinimal,
    } from '../Scanner';

    import Token from '../Token';
    // #endregion external
// #endregion imports



// #region module
/**
 * The tokens a value may be made of. A keyword is only a keyword where a declaration may begin, so
 * `import` is an ordinary word anywhere else.
 */
const VALUE_TOKENS = new Set([
    TokenType.SIGNIFIER,
    TokenType.STRING,
    TokenType.INTERPOLATE,
    TokenType.IDENTIFIER,
    TokenType.IMPORT,
    TokenType.INJECT,
    TokenType.FROM,
    TokenType.WITH,
]);


/**
 * A newline and a comma separate alike, so either ends an entry, an item, a cell, or an argument.
 */
const BOUNDARY_TOKENS = new Set([
    TokenType.NEWLINE,
    TokenType.COMMA,
]);


/**
 * Where an unquoted value ends. It runs to a separator or to the delimiter of whatever encloses
 * it, so the enclosing group is what decides.
 */
const DECLARATION_STOPS = new Set([
    TokenType.NEWLINE,
    TokenType.COMMA,
    TokenType.EOF,
]);

const MAP_STOPS = new Set([
    TokenType.NEWLINE,
    TokenType.COMMA,
    TokenType.RIGHT_CURLY_BRACKET,
]);

const LIST_STOPS = new Set([
    TokenType.NEWLINE,
    TokenType.COMMA,
    TokenType.RIGHT_SQUARE_BRACKET,
]);

const CALL_STOPS = new Set([
    TokenType.NEWLINE,
    TokenType.COMMA,
    TokenType.RIGHT_PARENTHESIS,
]);


const BARE_NAME = /^[A-Za-z0-9_-]+$/;


/**
 * How deeply a document may nest before the parser refuses to follow it.
 *
 * The same limit the `Rust` implementation keeps, so that a document is either read by both or
 * refused by both. The number is what the smaller of the two hosts will bear — a 2 MiB stack, which
 * is what a spawned thread is given by default — with a wide margin, and it is far past any nesting a
 * person would write.
 */
export const MAX_DEPTH = 128;



class Parser {
    private readonly tokens: Token[];
    private readonly sourceName: string;
    private current = 0;
    private depth = 0;

    constructor(
        tokens: Token[],
        _error?: unknown,
        sourceName?: string,
    ) {
        this.tokens = tokens;
        this.sourceName = sourceName ?? tokens[0]?.source ?? '<memory>';
    }


    /**
     * A document is any number of declarations around exactly one root. They may be written in any
     * order, so the root is not known to be missing until the end.
     */
    public parse(): DocumentNode {
        const declarations: DeclarationNode[] = [];
        let root: MapNode | ListNode | null = null;

        this.skipSeparators();

        while (!this.check(TokenType.EOF)) {
            if (this.check(TokenType.IMPORT) || this.check(TokenType.INJECT)) {
                declarations.push(this.resource());
            } else if (
                this.check(TokenType.LEFT_CURLY_BRACKET)
                || this.check(TokenType.LEFT_SQUARE_BRACKET)
            ) {
                if (root) {
                    this.fail(
                        DiagnosticCode.PARSE_ROOT,
                        'A document may contain only one root map or list.',
                    );
                }

                root = this.check(TokenType.LEFT_CURLY_BRACKET)
                    ? this.map()
                    : this.list();
            } else {
                declarations.push(this.leaflink());
            }

            this.skipSeparators();
        }

        if (!root) {
            this.fail(
                DiagnosticCode.PARSE_ROOT,
                'A document requires one root map or list.',
            );
        }

        return {
            type: 'document',
            declarations,
            root,
            source: this.sourceName,
        };
    }


    private resource(): DeclarationNode {
        const keyword = this.advance();
        const name = this.name('Expected a resource declaration name.');

        this.consume(TokenType.FROM, "Expected 'from' in resource declaration.");

        const target = this.atom('Expected a resource target.');

        let authenticator: ValueNode | null = null;

        if (this.match(TokenType.WITH)) {
            authenticator = this.value(DECLARATION_STOPS);
        }

        return {
            type: keyword.type === TokenType.IMPORT ? 'import' : 'inject',
            name: this.tokenValue(name),
            target: this.tokenValue(target),
            authenticator,
            token: keyword,
        };
    }


    private leaflink(): DeclarationNode {
        const name = this.name('Expected a leaflink declaration name.');

        // A declaration with nothing after it holds the empty string.
        const value = this.isBoundary(this.peek()) || this.check(TokenType.EOF)
            ? scalarNode('', name)
            : this.value(DECLARATION_STOPS);

        return {
            type: 'leaflink',
            name: this.tokenValue(name),
            value,
            token: name,
        };
    }


    private map(): MapNode {
        const open = this.consume(TokenType.LEFT_CURLY_BRACKET, "Expected '{'.");
        const entries: MapNode['entries'] = [];

        this.skipSeparators();

        while (
            !this.check(TokenType.RIGHT_CURLY_BRACKET)
            && !this.check(TokenType.EOF)
        ) {
            if (this.match(TokenType.SPREAD)) {
                const token = this.previous();

                entries.push({
                    type: 'spread-entry',
                    reference: token.literal as Reference,
                    token,
                });
            } else if (this.match(TokenType.LINK)) {
                // The shortened form: the link names the key it is received under.
                const token = this.previous();

                const link: LinkNode = {
                    type: 'link',
                    reference: token.literal as Reference,
                    token,
                };

                entries.push({
                    type: 'link-entry',
                    value: this.check(TokenType.LEFT_PARENTHESIS) ? this.call(link) : link,
                    token,
                });
            } else {
                const name = this.name('Expected a map key.');

                let value: ValueNode;

                if (this.check(TokenType.LEFT_ANGLE_BRACKET)) {
                    value = this.structure();
                } else if (
                    this.isBoundary(this.peek())
                    || this.check(TokenType.RIGHT_CURLY_BRACKET)
                ) {
                    value = scalarNode('', name);
                } else {
                    value = this.value(MAP_STOPS);
                }

                entries.push({
                    type: 'entry',
                    name: this.tokenValue(name),
                    value,
                    token: name,
                });
            }

            if (!this.check(TokenType.RIGHT_CURLY_BRACKET)) {
                this.requireBoundary('map entry');
            }

            this.skipSeparators();
        }

        this.consume(TokenType.RIGHT_CURLY_BRACKET, "Expected '}' after map.");

        return {
            type: 'map',
            entries,
            token: open,
        };
    }


    private list(): ListNode {
        const open = this.consume(TokenType.LEFT_SQUARE_BRACKET, "Expected '['.");
        const items: ListNode['items'] = [];

        this.skipSeparators();

        while (
            !this.check(TokenType.RIGHT_SQUARE_BRACKET)
            && !this.check(TokenType.EOF)
        ) {
            if (this.match(TokenType.SPREAD)) {
                const token = this.previous();

                items.push({
                    type: 'spread-item',
                    reference: token.literal as Reference,
                    token,
                });
            } else {
                items.push(this.value(LIST_STOPS));
            }

            if (!this.check(TokenType.RIGHT_SQUARE_BRACKET)) {
                this.requireBoundary('list item');
            }

            this.skipSeparators();
        }

        this.consume(TokenType.RIGHT_SQUARE_BRACKET, "Expected ']' after list.");

        return {
            type: 'list',
            items,
            token: open,
        };
    }


    /**
     * A structure is a signature and the rows under it. A row ends at a newline, so a cell may hold
     * anything that does not itself cross one.
     */
    private structure(): StructureNode {
        const open = this.consume(TokenType.LEFT_ANGLE_BRACKET, "Expected '<'.");
        const fields: string[] = [];

        this.skipNewlines();

        while (
            !this.check(TokenType.RIGHT_ANGLE_BRACKET)
            && !this.check(TokenType.EOF)
        ) {
            fields.push(this.tokenValue(this.name('Expected a structure field.')));
            this.skipNewlines();

            if (!this.match(TokenType.COMMA)) {
                break;
            }

            this.skipNewlines();
        }

        this.consume(
            TokenType.RIGHT_ANGLE_BRACKET,
            "Expected '>' after structure signature.",
        );

        this.skipNewlines();

        this.consume(
            TokenType.LEFT_SQUARE_BRACKET,
            "Expected '[' after structure signature.",
        );

        const rows: ValueNode[][] = [];

        this.skipNewlines();

        while (
            !this.check(TokenType.RIGHT_SQUARE_BRACKET)
            && !this.check(TokenType.EOF)
        ) {
            const row: ValueNode[] = [this.value(LIST_STOPS)];

            while (this.match(TokenType.COMMA)) {
                this.skipNewlines();

                if (this.check(TokenType.RIGHT_SQUARE_BRACKET)) {
                    break;
                }

                row.push(this.value(LIST_STOPS));
            }

            rows.push(row);

            if (
                !this.check(TokenType.RIGHT_SQUARE_BRACKET)
                && !this.check(TokenType.NEWLINE)
            ) {
                this.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    'Expected a newline after a structure row.',
                );
            }

            this.skipNewlines();
        }

        this.consume(TokenType.RIGHT_SQUARE_BRACKET, "Expected ']' after structure rows.");

        return {
            type: 'structure',
            fields,
            rows,
            token: open,
        };
    }


    /**
     * A value may contain a value, so the parser recurses as deeply as the document nests — and a
     * document is data, which means it can come from somewhere that does not wish the reader well.
     * Past the limit, the parser stops and says so.
     *
     * The refusal has to be a `deon` diagnostic, carrying a code and a position, rather than whatever
     * the host does when its stack runs out: a caller can act on `DEON_PARSE_EXPECTED`, and cannot act
     * on a `RangeError`. The limit is far above any document a person would write, and far below the
     * depth at which the recursion would take the process down with it.
     */
    private value(
        stops: Set<TokenType>,
    ): ValueNode {
        this.depth += 1;

        try {
            if (this.depth > MAX_DEPTH) {
                this.fail(
                    DiagnosticCode.PARSE_EXPECTED,
                    'The document nests more deeply than the parser will follow.',
                );
            }

            return this.valueInner(stops);
        } finally {
            this.depth -= 1;
        }
    }


    private valueInner(
        stops: Set<TokenType>,
    ): ValueNode {
        if (this.check(TokenType.LEFT_CURLY_BRACKET)) {
            return this.map();
        }

        if (this.check(TokenType.LEFT_SQUARE_BRACKET)) {
            return this.list();
        }

        if (this.check(TokenType.LEFT_ANGLE_BRACKET)) {
            return this.structure();
        }

        if (this.match(TokenType.LINK)) {
            const token = this.previous();

            const link: LinkNode = {
                type: 'link',
                reference: token.literal as Reference,
                token,
            };

            return this.check(TokenType.LEFT_PARENTHESIS) ? this.call(link) : link;
        }

        return this.scalar(stops);
    }


    private call(
        link: LinkNode,
    ): CallNode {
        const open = this.consume(TokenType.LEFT_PARENTHESIS, "Expected '('.");
        const args: CallArgumentNode[] = [];

        this.skipSeparators();

        while (
            !this.check(TokenType.RIGHT_PARENTHESIS)
            && !this.check(TokenType.EOF)
        ) {
            const name = this.name('Expected an entity argument name.');

            const value = this.isBoundary(this.peek())
                || this.check(TokenType.RIGHT_PARENTHESIS)
                ? scalarNode('', name)
                : this.value(CALL_STOPS);

            args.push({
                name: this.tokenValue(name),
                value,
                token: name,
            });

            if (!this.check(TokenType.RIGHT_PARENTHESIS)) {
                this.requireBoundary('entity argument');
            }

            this.skipSeparators();
        }

        this.consume(TokenType.RIGHT_PARENTHESIS, "Expected ')' after entity arguments.");

        return {
            type: 'call',
            reference: link.reference,
            arguments: args,
            token: open,
        };
    }


    /**
     * An unquoted value is made of every token up to its boundary, put back together with the
     * whitespace that separated them, so that `two words` stays two words.
     */
    private scalar(
        stops: Set<TokenType>,
    ) {
        // A string is quoted only when the value begins with the quote. Anywhere else the quote is
        // an ordinary character of an unquoted string, which runs to the boundary (4.3).
        if (this.check(TokenType.STRING)) {
            const quoted = this.advance();

            return scalarNode(this.tokenValue(quoted), quoted);
        }

        const fragments: string[] = [];
        let token: Token | null = null;

        while (
            !this.check(TokenType.EOF)
            && !stops.has(this.peek().type)
            && VALUE_TOKENS.has(this.peek().type)
        ) {
            const current = this.advance();
            token ??= current;

            // `leading` is the whitespace read before the token, and the first token of a value has
            // none of its own: what came before it separated it from the key.
            fragments.push(`${fragments.length ? current.leading : ''}${current.lexeme}`);
        }

        if (!token) {
            this.fail(DiagnosticCode.PARSE_EXPECTED, 'Expected a value.');
        }

        return scalarNode(decodeMinimal(fragments.join('')), token);
    }


    private tokenValue(
        token: Token,
    ) {
        return typeof token.literal === 'string' ? token.literal : token.lexeme;
    }


    /**
     * A name is a bare word or a singlequoted string. A backticked string may span lines, which a
     * name may not.
     */
    private name(
        message: string,
    ) {
        if (
            VALUE_TOKENS.has(this.peek().type)
            && this.peek().type !== TokenType.INTERPOLATE
        ) {
            const token = this.advance();

            const singlequoted = token.type === TokenType.STRING
                && token.lexeme.startsWith("'");
            const bare = token.type !== TokenType.STRING
                && BARE_NAME.test(this.tokenValue(token));

            if (singlequoted || bare) {
                return token;
            }

            return deonError(
                DiagnosticCode.LEX_INVALID,
                `Invalid unquoted name '${this.tokenValue(token)}'.`,
                token,
            );
        }

        this.fail(DiagnosticCode.PARSE_EXPECTED, message);
    }


    /**
     * A resource target is one token, and it may not be a backticked string, whose trimming would
     * make the target something other than what was written.
     */
    private atom(
        message: string,
    ) {
        if (
            VALUE_TOKENS.has(this.peek().type)
            && this.peek().type !== TokenType.INTERPOLATE
        ) {
            const token = this.advance();

            if (token.type !== TokenType.STRING || token.lexeme.startsWith("'")) {
                return token;
            }

            return deonError(
                DiagnosticCode.LEX_INVALID,
                'A resource target cannot be a multiline string.',
                token,
            );
        }

        this.fail(DiagnosticCode.PARSE_EXPECTED, message);
    }


    private requireBoundary(
        entity: string,
    ) {
        if (!this.isBoundary(this.peek())) {
            this.fail(
                DiagnosticCode.PARSE_EXPECTED,
                `Expected a comma or newline after ${entity}.`,
            );
        }
    }


    private consume(
        type: TokenType,
        message: string,
    ) {
        if (this.check(type)) {
            return this.advance();
        }

        this.fail(DiagnosticCode.PARSE_EXPECTED, message);
    }


    private skipSeparators() {
        while (this.match(TokenType.NEWLINE) || this.match(TokenType.COMMA)) {
            // The separators carry no meaning of their own.
        }
    }


    private skipNewlines() {
        while (this.match(TokenType.NEWLINE)) {
            // As above.
        }
    }


    private isBoundary(
        token: Token,
    ) {
        return BOUNDARY_TOKENS.has(token.type);
    }


    private match(
        type: TokenType,
    ) {
        if (!this.check(type)) {
            return false;
        }

        this.advance();

        return true;
    }


    private check(
        type: TokenType,
    ) {
        return this.peek().type === type;
    }


    private advance() {
        if (!this.check(TokenType.EOF)) {
            this.current += 1;
        }

        return this.tokens[this.current - 1];
    }


    private previous() {
        return this.tokens[this.current - 1];
    }


    private peek() {
        return this.tokens[this.current];
    }


    private fail(
        code: Parameters<typeof deonError>[0],
        message: string,
    ): never {
        return deonError(code, message, this.peek());
    }
}



/**
 * A key written twice is valid, and the last write is the one that holds, but it is almost always
 * a mistake, so the linter says so. A key replaced by a spread is not reported.
 */
const lintValue = (
    value: ValueNode,
    diagnostics: DeonDiagnostic[],
) => {
    if (value.type === 'map') {
        const names = new Set<string>();

        for (const entry of value.entries) {
            if (entry.type === 'entry') {
                if (names.has(entry.name)) {
                    diagnostics.push(new DeonDiagnostic(
                        DiagnosticCode.LINT_DUPLICATE_KEY,
                        `Map key '${entry.name}' is written more than once.`,
                        entry.token,
                        'warning',
                    ));
                }

                names.add(entry.name);
                lintValue(entry.value, diagnostics);
            } else if (entry.type === 'link-entry') {
                const segment = entry.value.reference[entry.value.reference.length - 1] ?? '';
                const name = segment.startsWith('$') ? segment.slice(1) : segment;

                if (names.has(name)) {
                    diagnostics.push(new DeonDiagnostic(
                        DiagnosticCode.LINT_DUPLICATE_KEY,
                        `Map key '${name}' is written more than once.`,
                        entry.token,
                        'warning',
                    ));
                }

                names.add(name);

                if (entry.value.type === 'call') {
                    for (const argument of entry.value.arguments) {
                        lintValue(argument.value, diagnostics);
                    }
                }
            }
        }
    } else if (value.type === 'list') {
        for (const item of value.items) {
            if (item.type !== 'spread-item') {
                lintValue(item, diagnostics);
            }
        }
    } else if (value.type === 'structure') {
        for (const row of value.rows) {
            for (const cell of row) {
                lintValue(cell, diagnostics);
            }
        }
    } else if (value.type === 'call') {
        for (const argument of value.arguments) {
            lintValue(argument.value, diagnostics);
        }
    }
}


export const lintDocument = (
    document: DocumentNode,
) => {
    const diagnostics: DeonDiagnostic[] = [];

    lintValue(document.root, diagnostics);

    for (const declaration of document.declarations) {
        if (declaration.type === 'leaflink') {
            lintValue(declaration.value, diagnostics);
        }
    }

    return diagnostics;
}
// #endregion module



// #region exports
export default Parser;
// #endregion exports
