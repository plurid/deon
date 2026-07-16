// Every language feature the server offers, computed from `@plurid/deon` and nothing else.
//
// The pipeline is deliberately the *syntax* one — `parseSyntax`, `lint`, `entities` — which scans and
// parses but never interprets. So it reaches no file and opens no socket: an `import ./secret.deon`
// in an editor buffer is described, never fetched, and the server needs no capability and cannot
// hang on a network read. Interpretation-time faults (an unresolved link, a cycle) are left to the
// command-line tool, which is where a document is actually evaluated.

// #region imports
    import Deon from '@plurid/deon';
    import type {
        DocumentNode,
        DeclarationNode,
        ValueNode,
        MapItemNode,
        CallNode,
        Reference,
        Token,
    } from '@plurid/deon';

    import {
        DiagnosticSeverity,
        SymbolKind,
        CompletionItemKind,
        SemanticTokenType,
        SemanticTokenModifier,
        type LspDiagnostic,
        type DocumentSymbol,
        type Location,
        type Hover,
        type CompletionItem,
        type SemanticTokens,
        type SignatureHelp,
    } from './protocol.js';

    import {
        lineStarts,
        toLspPosition,
        toLspRange,
        toDeonPosition,
        withinSpan,
        type LspPosition,
        type LspRange,
        type DeonRange,
    } from './positions.js';
// #endregion imports



// #region types
interface DeonSpan {
    offset: number;
    line: number;
    column: number;
}

interface DeonDiagnostic {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    range: { start: DeonSpan; end: DeonSpan };
    related: { start: DeonSpan; end: DeonSpan }[];
}

interface DeonEntity {
    name: string;
    parameters: string[];
    kind: string;
}

interface FoundReference {
    head: string;
    token: Token;
}
// #endregion types



// #region helpers
/**
 * A token's own span, in the Deon line/column a diagnostic and the position adapter both speak.
 */
const tokenRange = (
    token: Token,
): DeonRange => ({
    start: { line: token.line, column: token.column },
    end: { line: token.endLine, column: token.endColumn },
});


const spanRange = (
    span: { start: DeonSpan; end: DeonSpan },
): DeonRange => ({
    start: { line: span.start.line, column: span.start.column },
    end: { line: span.end.line, column: span.end.column },
});


/**
 * Walk every value a document holds, in the order written, and hand each reference — a link, a call,
 * a spread — to the visitor with the token that carries it. The declarations are values too: a
 * leaflink's value, an import's authenticator.
 */
const eachReference = (
    document: DocumentNode,
    visit: (reference: FoundReference) => void,
): void => {
    const value = (node: ValueNode): void => {
        switch (node.type) {
            case 'scalar':
                return;
            case 'link':
                visit({ head: node.reference.head, token: node.token });
                return;
            case 'call':
                visit({ head: node.reference.head, token: node.token });
                for (const argument of node.arguments) {
                    value(argument.value);
                }
                return;
            case 'map':
                for (const entry of node.entries) {
                    item(entry);
                }
                return;
            case 'list':
                for (const element of node.items) {
                    if (element.type === 'spread-item') {
                        visit({ head: element.reference.head, token: element.token });
                    } else {
                        value(element);
                    }
                }
                return;
            case 'structure':
                for (const row of node.rows) {
                    for (const cell of row) {
                        value(cell);
                    }
                }
                return;
        }
    };

    const item = (node: MapItemNode): void => {
        switch (node.type) {
            case 'entry':
                value(node.value);
                return;
            case 'link-entry':
                visit({ head: node.value.reference.head, token: node.value.token });
                return;
            case 'spread-entry':
                visit({ head: node.reference.head, token: node.token });
                return;
        }
    };

    for (const declaration of document.declarations) {
        if (declaration.type === 'leaflink') {
            value(declaration.value);
        } else if (declaration.authenticator) {
            value(declaration.authenticator);
        }
    }
    value(document.root);
};


const referenceAt = (
    document: DocumentNode,
    line: number,
    column: number,
): FoundReference | null => {
    let found: FoundReference | null = null;
    eachReference(document, (reference) => {
        const token = reference.token;
        if (withinSpan(line, column, token.line, token.column, token.endLine, token.endColumn)) {
            found = reference;
        }
    });
    return found;
};


const declarationAt = (
    document: DocumentNode,
    line: number,
    column: number,
): DeclarationNode | null => {
    for (const declaration of document.declarations) {
        const token = declaration.token;
        if (withinSpan(line, column, token.line, token.column, token.endLine, token.endColumn)) {
            return declaration;
        }
    }
    return null;
};


const declarationNamed = (
    document: DocumentNode,
    name: string,
): DeclarationNode | null => {
    for (const declaration of document.declarations) {
        if (declaration.name === name) {
            return declaration;
        }
    }
    return null;
};


const describeDeclaration = (
    declaration: DeclarationNode,
): string => {
    if (declaration.type === 'leaflink') {
        return `**leaflink** \`${declaration.name}\``;
    }
    return `**${declaration.type}** \`${declaration.name}\` from \`${declaration.target}\``;
};


const describeEntity = (
    entity: DeonEntity,
): string => {
    const parameters = entity.parameters.length
        ? `(${entity.parameters.join(', ')})`
        : '()';
    return `**entity** \`${entity.name}${parameters}\``;
};
// #endregion helpers



// #region module
/**
 * The analyser holds one `Deon` and, per document, the last syntax tree that parsed. Completion
 * reads that cache, so a name still completes while the line being typed is momentarily unparseable.
 */
export class Analysis {
    private readonly deon = new Deon();
    private readonly lastGood = new Map<string, DocumentNode>();

    private syntax(
        uri: string,
        text: string,
    ): DocumentNode | null {
        try {
            const document = this.deon.parseSyntax(text, uri) as DocumentNode;
            this.lastGood.set(uri, document);
            return document;
        } catch {
            return null;
        }
    }

    public forget(
        uri: string,
    ): void {
        this.lastGood.delete(uri);
    }


    /**
     * The squiggles: the one lex-or-parse fault that stops a document, or — when it parses — every
     * lint warning the document earns. Both come back with the exact range the editor underlines.
     */
    public diagnostics(
        uri: string,
        text: string,
    ): LspDiagnostic[] {
        const starts = lineStarts(text);
        const out: LspDiagnostic[] = [];

        let parsed = false;
        try {
            this.deon.parseSyntax(text, uri);
            parsed = true;
        } catch (failure: any) {
            const diagnostics: DeonDiagnostic[] = failure?.diagnostics ?? [];
            for (const diagnostic of diagnostics) {
                out.push(this.toLsp(text, starts, uri, diagnostic));
            }
        }

        if (parsed) {
            this.lastGood.set(uri, this.deon.parseSyntax(text, uri) as DocumentNode);

            let warnings: DeonDiagnostic[] = [];
            try {
                warnings = this.deon.lint(text, uri) as DeonDiagnostic[];
            } catch {
                warnings = [];
            }
            for (const warning of warnings) {
                out.push(this.toLsp(text, starts, uri, warning));
            }
        }

        return out;
    }

    private toLsp(
        text: string,
        starts: number[],
        uri: string,
        diagnostic: DeonDiagnostic,
    ): LspDiagnostic {
        const related = diagnostic.related.map((span) => ({
            location: { uri, range: toLspRange(text, starts, spanRange(span)) },
            message: 'related location',
        }));

        return {
            range: toLspRange(text, starts, spanRange(diagnostic.range)),
            severity: diagnostic.severity === 'warning'
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Error,
            code: diagnostic.code,
            source: 'deon',
            message: diagnostic.message,
            relatedInformation: related.length ? related : undefined,
        };
    }


    /**
     * The outline: every declaration, then the root's own entries nested as deeply as they go.
     */
    public symbols(
        uri: string,
        text: string,
    ): DocumentSymbol[] {
        const starts = lineStarts(text);
        const document = this.syntax(uri, text);
        if (!document) {
            return [];
        }

        const out: DocumentSymbol[] = [];

        for (const declaration of document.declarations) {
            const range = toLspRange(text, starts, tokenRange(declaration.token));
            out.push({
                name: declaration.name,
                detail: declaration.type === 'leaflink'
                    ? undefined
                    : `${declaration.type} from ${declaration.target}`,
                kind: declaration.type === 'leaflink'
                    ? SymbolKind.Constant
                    : SymbolKind.Module,
                range,
                selectionRange: range,
            });
        }

        for (const entry of document.root.type === 'map'
            ? document.root.entries
            : []) {
            const symbol = this.mapItemSymbol(text, starts, entry);
            if (symbol) {
                out.push(symbol);
            }
        }

        if (document.root.type === 'list') {
            out.push(...this.valueChildren(text, starts, document.root));
        }

        return out;
    }

    private mapItemSymbol(
        text: string,
        starts: number[],
        entry: MapItemNode,
    ): DocumentSymbol | null {
        if (entry.type === 'spread-entry') {
            const range = toLspRange(text, starts, tokenRange(entry.token));
            return {
                name: `...#${entry.reference.head}`,
                kind: SymbolKind.Variable,
                range,
                selectionRange: range,
            };
        }

        if (entry.type === 'link-entry') {
            const range = toLspRange(text, starts, tokenRange(entry.token));
            return {
                name: `#${entry.value.reference.head}`,
                kind: SymbolKind.Variable,
                range,
                selectionRange: range,
            };
        }

        const range = toLspRange(text, starts, tokenRange(entry.token));
        return {
            name: entry.name,
            kind: this.kindOf(entry.value),
            range,
            selectionRange: range,
            children: this.valueChildren(text, starts, entry.value),
        };
    }

    private valueChildren(
        text: string,
        starts: number[],
        value: ValueNode,
    ): DocumentSymbol[] {
        if (value.type === 'map') {
            const children: DocumentSymbol[] = [];
            for (const entry of value.entries) {
                const symbol = this.mapItemSymbol(text, starts, entry);
                if (symbol) {
                    children.push(symbol);
                }
            }
            return children;
        }

        if (value.type === 'list') {
            const children: DocumentSymbol[] = [];
            value.items.forEach((element, index) => {
                if (element.type === 'spread-item') {
                    const range = toLspRange(text, starts, tokenRange(element.token));
                    children.push({
                        name: `...#${element.reference.head}`,
                        kind: SymbolKind.Variable,
                        range,
                        selectionRange: range,
                    });
                    return;
                }
                const range = toLspRange(text, starts, tokenRange(element.token));
                children.push({
                    name: String(index),
                    kind: this.kindOf(element),
                    range,
                    selectionRange: range,
                    children: this.valueChildren(text, starts, element),
                });
            });
            return children;
        }

        return [];
    }

    private kindOf(
        value: ValueNode,
    ): number {
        switch (value.type) {
            case 'map':
                return SymbolKind.Object;
            case 'list':
            case 'structure':
                return SymbolKind.Array;
            case 'link':
            case 'call':
                return SymbolKind.Variable;
            default:
                return SymbolKind.Field;
        }
    }


    /**
     * Go to where a referenced name was declared.
     */
    public definition(
        uri: string,
        text: string,
        position: LspPosition,
    ): Location | null {
        const starts = lineStarts(text);
        const document = this.syntax(uri, text);
        if (!document) {
            return null;
        }

        const cursor = toDeonPosition(text, starts, position);
        const reference = referenceAt(document, cursor.line, cursor.column);
        if (!reference) {
            return null;
        }

        const declaration = declarationNamed(document, reference.head);
        if (!declaration) {
            return null;
        }

        return {
            uri,
            range: toLspRange(text, starts, tokenRange(declaration.token)),
        };
    }


    /**
     * What the name under the cursor is — the declaration it points to, or, if the cursor sits on a
     * declaration, that declaration itself.
     */
    public hover(
        uri: string,
        text: string,
        position: LspPosition,
    ): Hover | null {
        const starts = lineStarts(text);
        const document = this.syntax(uri, text);
        if (!document) {
            return null;
        }

        const cursor = toDeonPosition(text, starts, position);

        const reference = referenceAt(document, cursor.line, cursor.column);
        if (reference) {
            const declaration = declarationNamed(document, reference.head);
            const value = declaration
                ? describeDeclaration(declaration)
                : this.describeName(uri, text, reference.head);
            return {
                contents: { kind: 'markdown', value },
                range: toLspRange(text, starts, tokenRange(reference.token)),
            };
        }

        const declaration = declarationAt(document, cursor.line, cursor.column);
        if (declaration) {
            return {
                contents: { kind: 'markdown', value: describeDeclaration(declaration) },
                range: toLspRange(text, starts, tokenRange(declaration.token)),
            };
        }

        return null;
    }

    private describeName(
        uri: string,
        text: string,
        head: string,
    ): string {
        const entity = this.entities(uri, text).find((candidate) => candidate.name === head);
        if (entity) {
            return describeEntity(entity);
        }
        return `\`${head}\``;
    }


    /**
     * The names a `#` may reach: every declaration, and every entity the document declares. Read from
     * the last tree that parsed, so a name still completes while the current line is half-typed.
     */
    public completion(
        uri: string,
        text: string,
        _position: LspPosition,
    ): CompletionItem[] {
        const document = this.syntax(uri, text) ?? this.lastGood.get(uri) ?? null;

        const items: CompletionItem[] = [];
        const seen = new Set<string>();

        const add = (label: string, kind: number, detail?: string): void => {
            if (seen.has(label)) {
                return;
            }
            seen.add(label);
            items.push({ label, kind, detail });
        };

        if (document) {
            for (const declaration of document.declarations) {
                if (declaration.type === 'leaflink') {
                    add(declaration.name, CompletionItemKind.Constant, 'leaflink');
                } else {
                    add(
                        declaration.name,
                        CompletionItemKind.Module,
                        `${declaration.type} from ${declaration.target}`,
                    );
                }
            }
        }

        for (const entity of this.entities(uri, text)) {
            add(entity.name, CompletionItemKind.Function, describeEntity(entity).replace(/\*\*/g, ''));
        }

        return items;
    }


    /**
     * The coloured spans an editor lays over the text so a name reads as a name, a key as a key, a
     * call argument as an argument. Every token the tree carries a lexeme for is emitted once, in
     * reading order, then encoded as the protocol's flat run of five-integer deltas against the
     * legend the server declared on `initialize`. The call *head* has no token of its own — it sits
     * before the `(` the call is anchored at — so it is left to the TextMate grammar to colour; the
     * arguments, keys, links, and scalars each have one and are coloured here.
     */
    public semanticTokens(
        uri: string,
        text: string,
    ): SemanticTokens {
        const document = this.syntax(uri, text) ?? this.lastGood.get(uri) ?? null;
        if (!document) {
            return { data: [] };
        }

        const starts = lineStarts(text);
        const raw: {
            line: number;
            character: number;
            length: number;
            type: number;
            modifiers: number;
        }[] = [];

        const emit = (
            token: Token,
            type: number,
            modifiers = 0,
        ): void => {
            // A token spanning lines (a multiline string) would have to be split per line to encode;
            // it is left uncoloured rather than encoded wrong. The length is the lexeme's UTF-16 code
            // units, which is the unit the protocol's default encoding measures a token's length in.
            if (!token.lexeme || token.endLine !== token.line) {
                return;
            }
            const at = toLspPosition(text, starts, token.line, token.column);
            raw.push({
                line: at.line,
                character: at.character,
                length: token.lexeme.length,
                type,
                modifiers,
            });
        };

        const call = (node: CallNode): void => {
            for (const argument of node.arguments) {
                emit(argument.token, SemanticTokenType.parameter);
                value(argument.value);
            }
        };

        const value = (node: ValueNode): void => {
            switch (node.type) {
                case 'scalar':
                    emit(node.token, SemanticTokenType.string);
                    return;
                case 'link':
                    emit(node.token, SemanticTokenType.variable);
                    return;
                case 'call':
                    call(node);
                    return;
                case 'map':
                    for (const entry of node.entries) {
                        item(entry);
                    }
                    return;
                case 'list':
                    for (const element of node.items) {
                        if (element.type === 'spread-item') {
                            emit(element.token, SemanticTokenType.variable);
                        } else {
                            value(element);
                        }
                    }
                    return;
                case 'structure':
                    for (const row of node.rows) {
                        for (const cell of row) {
                            value(cell);
                        }
                    }
                    return;
            }
        };

        const item = (node: MapItemNode): void => {
            switch (node.type) {
                case 'entry':
                    emit(node.token, SemanticTokenType.property);
                    value(node.value);
                    return;
                case 'link-entry':
                    if (node.value.type === 'call') {
                        call(node.value);
                    } else {
                        emit(node.value.token, SemanticTokenType.variable);
                    }
                    return;
                case 'spread-entry':
                    emit(node.token, SemanticTokenType.variable);
                    return;
            }
        };

        for (const declaration of document.declarations) {
            if (declaration.type === 'leaflink') {
                emit(declaration.token, SemanticTokenType.variable, SemanticTokenModifier.declaration);
                value(declaration.value);
            } else {
                emit(declaration.token, SemanticTokenType.keyword);
                if (declaration.authenticator) {
                    value(declaration.authenticator);
                }
            }
        }
        value(document.root);

        raw.sort((a, b) => a.line - b.line || a.character - b.character);

        const data: number[] = [];
        let previousLine = 0;
        let previousCharacter = 0;
        for (const token of raw) {
            const deltaLine = token.line - previousLine;
            const deltaCharacter = deltaLine === 0
                ? token.character - previousCharacter
                : token.character;
            data.push(deltaLine, deltaCharacter, token.length, token.type, token.modifiers);
            previousLine = token.line;
            previousCharacter = token.character;
        }

        return { data };
    }


    /**
     * Signature help for an entity call: while the cursor sits inside a call's parentheses, the
     * entity's parameter list is shown with the argument being written picked out. The parameters
     * come from the entity's own declaration when the document names one, and otherwise from the
     * argument names already written — so help still appears for a call to a name declared in a file
     * the editor buffer only imports.
     */
    public signatureHelp(
        uri: string,
        text: string,
        position: LspPosition,
    ): SignatureHelp | null {
        const document = this.syntax(uri, text) ?? this.lastGood.get(uri) ?? null;
        if (!document) {
            return null;
        }

        const starts = lineStarts(text);
        const cursor = toDeonPosition(text, starts, position);

        const calls: CallNode[] = [];
        const collect = (node: ValueNode): void => {
            switch (node.type) {
                case 'call':
                    calls.push(node);
                    for (const argument of node.arguments) {
                        collect(argument.value);
                    }
                    return;
                case 'map':
                    for (const entry of node.entries) {
                        if (entry.type === 'entry') {
                            collect(entry.value);
                        } else if (entry.type === 'link-entry' && entry.value.type === 'call') {
                            collect(entry.value);
                        }
                    }
                    return;
                case 'list':
                    for (const element of node.items) {
                        if (element.type !== 'spread-item') {
                            collect(element);
                        }
                    }
                    return;
                case 'structure':
                    for (const row of node.rows) {
                        for (const cell of row) {
                            collect(cell);
                        }
                    }
                    return;
            }
        };
        for (const declaration of document.declarations) {
            if (declaration.type === 'leaflink') {
                collect(declaration.value);
            } else if (declaration.authenticator) {
                collect(declaration.authenticator);
            }
        }
        collect(document.root);

        // The call the cursor is writing into: on the same line as its `(`, at or past that `(`, and
        // not run far past the last argument (a little slack covers the closing `)` and the space
        // before the next argument). When calls nest, the innermost wins — the one whose `(` is latest.
        let best: CallNode | null = null;
        for (const node of calls) {
            const open = node.token;
            if (open.line !== cursor.line || open.column > cursor.column) {
                continue;
            }
            const last = node.arguments[node.arguments.length - 1];
            const endColumn = last ? last.value.token.endColumn : open.endColumn;
            if (cursor.column > endColumn + 2) {
                continue;
            }
            if (!best || open.column > best.token.column) {
                best = node;
            }
        }
        if (!best) {
            return null;
        }

        const entity = this.entities(uri, text).find((candidate) => candidate.name === best!.reference.head);
        const parameters = entity && entity.parameters.length
            ? entity.parameters
            : best.arguments.map((argument) => argument.name);
        const label = `${best.reference.head}(${parameters.join(', ')})`;

        // The argument being written: as many arguments as already end at or before the cursor,
        // never past the last parameter.
        let active = 0;
        for (const argument of best.arguments) {
            if (argument.value.token.endColumn <= cursor.column) {
                active += 1;
            } else {
                break;
            }
        }
        active = parameters.length > 0
            ? Math.min(active, parameters.length - 1)
            : 0;

        return {
            signatures: [{
                label,
                parameters: parameters.map((parameter) => ({ label: parameter })),
            }],
            activeSignature: 0,
            activeParameter: active,
        };
    }

    private entities(
        uri: string,
        text: string,
    ): DeonEntity[] {
        try {
            return this.deon.entities(text, uri) as DeonEntity[];
        } catch {
            return [];
        }
    }
}
// #endregion module
