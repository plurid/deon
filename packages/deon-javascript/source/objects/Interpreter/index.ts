// #region imports
    // #region external
    import {
        deonParseOptions,
    } from '../../data/constants';

    import type {
        AccessSegment,
        DeclarationNode,
        DeonValue,
        DocumentNode,
        LeaflinkNode,
        MapNode,
        Reference,
        ResourceNode,
        ValueNode,
    } from '../../data/syntax';

    import type {
        DeonInterpreterOptions,
        PartialDeonParseOptions,
    } from '../../data/interfaces';

    import {
        resolveMappedAbsolutePath,
    } from '../../utilities/general';

    import {
        parseJSON,
    } from '../../utilities/json';

    import {
        deonError,
        DeonError,
        DiagnosticCode,
    } from '../Diagnostic';

    import {
        ESCAPED_INTERPOLATION,
        parseReference,
    } from '../Scanner';

    import Token from '../Token';

    import {
        TokenType,
    } from '../../data/enumerations';
    // #endregion external
// #endregion imports



// #region module
/**
 * The arguments of an entity call, bound for the length of that call and shadowing the leaflinks
 * around it.
 */
type Locals = ReadonlyMap<string, string>;


type FetchResult = {
    data: string;
    filetype?: string;
    filebase?: string;
    resourceId?: string;
};


/**
 * The parse options, with everything the evaluation cannot do without already decided.
 */
type RuntimeOptions = Required<Pick<PartialDeonParseOptions,
    | 'allowFilesystem'
    | 'allowNetwork'
    | 'environment'
    | 'expansion'
    | 'resources'
    | 'resourceStack'
>> & PartialDeonParseOptions;


const own = (
    value: object,
    key: string,
) => Object.prototype.hasOwnProperty.call(value, key);


/**
 * A map keeps the position of its last write, so a key written again moves to the end rather than
 * staying where it first appeared.
 */
const setOrdered = (
    target: Record<string, DeonValue>,
    key: string,
    value: DeonValue,
) => {
    if (own(target, key)) {
        delete target[key];
    }

    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
}


/**
 * A spread copies, it does not alias, so what it hands over must share nothing with its source.
 */
const clone = (
    value: DeonValue,
): DeonValue => {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(clone);
    }

    const result: Record<string, DeonValue> = {};

    for (const [key, entry] of Object.entries(value)) {
        setOrdered(result, key, clone(entry));
    }

    return result;
}


/**
 * Brings a host value into the Deon data model, where everything is a string, a list, or a map.
 */
const normalizeHostValue = (
    value: unknown,
): DeonValue => {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Deon cannot represent non-finite numbers.');
        }

        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map(normalizeHostValue);
    }

    if (typeof value === 'object') {
        const result: Record<string, DeonValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            setOrdered(result, key, normalizeHostValue(entry));
        }

        return result;
    }

    throw new TypeError(`Deon cannot represent a value of type '${typeof value}'.`);
}


/**
 * A loaded resource re-enters the tree as an ordinary value, so that whatever links to it cannot
 * tell it came from somewhere else.
 */
const nodeFromValue = (
    value: DeonValue,
    token: Token,
): ValueNode => {
    if (typeof value === 'string') {
        return {
            type: 'scalar',
            value,
            token,
        };
    }

    if (Array.isArray(value)) {
        return {
            type: 'list',
            items: value.map(entry => nodeFromValue(entry, token)),
            token,
        };
    }

    return {
        type: 'map',
        entries: Object.entries(value).map(([name, entry]) => ({
            type: 'entry',
            name,
            value: nodeFromValue(entry, token),
            token,
        })),
        token,
    };
}


/**
 * Imports, injections, and leaflinks share one namespace, so a name may be declared only once.
 */
const validateDeclarations = (
    document: DocumentNode,
) => {
    const declarations = new Map<string, DeclarationNode>();

    for (const declaration of document.declarations) {
        const first = declarations.get(declaration.name);

        if (first) {
            // The repeat is the primary span; the first declaration is where the reader is sent.
            deonError(
                DiagnosticCode.DUPLICATE_DECLARATION,
                `Declaration '${declaration.name}' is defined more than once.`,
                declaration.token,
                [first.token],
            );
        }

        declarations.set(declaration.name, declaration);
    }

    return declarations;
}



/**
 * Evaluates a document whose resources have already been loaded, so that nothing here reaches for
 * the filesystem or the network.
 */
class Evaluator {
    private readonly declarations: Map<string, LeaflinkNode>;
    private readonly options: RuntimeOptions;
    private readonly cache = new Map<string, DeonValue>();
    private readonly resolving: string[] = [];
    private readonly calling: string[] = [];

    /**
     * The running cost of substitution, in code points (specification 11). Interpolation and string
     * spread are the only ways a value grows past what the document literally wrote, so counting both
     * here — and nothing else — is what bounds the doubling blow-up by which a few lines assemble
     * gigabytes.
     */
    private expansion = 0;

    constructor(
        private readonly document: DocumentNode,
        options: RuntimeOptions,
    ) {
        this.options = options;
        this.declarations = new Map();

        for (const declaration of document.declarations) {
            if (declaration.type !== 'leaflink') {
                deonError(
                    DiagnosticCode.RESOURCE_IO,
                    `Resource '${declaration.name}' was not materialized.`,
                    declaration.token,
                );
            }

            const first = this.declarations.get(declaration.name);

            if (first) {
                // The repeat is the primary span; the first declaration is where the reader is sent.
                deonError(
                    DiagnosticCode.DUPLICATE_DECLARATION,
                    `Declaration '${declaration.name}' is defined more than once.`,
                    declaration.token,
                    [first.token],
                );
            }

            this.declarations.set(declaration.name, declaration);
        }
    }


    public evaluate() {
        return this.value(this.document.root, new Map());
    }


    public evaluateNode(
        node: ValueNode,
    ) {
        return this.value(node, new Map());
    }


    /**
     * Every declaration, evaluated. Editors read this to offer completions, so a leaflink that
     * cannot stand on its own, through a cycle or a broken link, is left out rather than failing
     * the whole lookup.
     */
    public leaflinks() {
        const result: Record<string, DeonValue> = {};

        for (const [name, declaration] of this.declarations) {
            try {
                setOrdered(result, name, this.resolveName(name, declaration.token));
            } catch {
                continue;
            }
        }

        return result;
    }


    private value(
        node: ValueNode,
        locals: Locals,
    ): DeonValue {
        if (node.type === 'scalar') {
            return this.interpolate(node.value, node.token, locals);
        }

        if (node.type === 'link') {
            return clone(this.reference(node.reference, node.token, locals));
        }

        if (node.type === 'call') {
            return this.call(node.reference, node.arguments, node.token, locals);
        }

        if (node.type === 'map') {
            return this.map(node, locals);
        }

        if (node.type === 'list') {
            return this.list(node.items, locals);
        }

        return this.structure(node, locals);
    }


    private list(
        items: Extract<ValueNode, { type: 'list' }>['items'],
        locals: Locals,
    ) {
        const result: DeonValue[] = [];

        for (const item of items) {
            if (item.type !== 'spread-item') {
                result.push(this.value(item, locals));
                continue;
            }

            const spread = this.reference(item.reference, item.token, locals);

            // A string spreads into a list as its code points.
            if (typeof spread === 'string') {
                const points = Array.from(spread);

                // Copying those code points is expansion, counted against the budget (specification 11).
                this.charge(points.length);

                result.push(...points);
            } else if (Array.isArray(spread)) {
                result.push(...spread.map(clone));
            } else {
                deonError(
                    DiagnosticCode.TYPE_MISMATCH,
                    'A list can spread only a list or string.',
                    item.token,
                );
            }
        }

        return result;
    }


    /**
     * A structure is a list of maps written as a table, so every row must carry exactly as many
     * cells as the signature has fields.
     */
    private structure(
        node: Extract<ValueNode, { type: 'structure' }>,
        locals: Locals,
    ) {
        const duplicate = node.fields.find(
            (field, index) => node.fields.indexOf(field) !== index,
        );

        if (duplicate) {
            deonError(
                DiagnosticCode.STRUCTURE_ARITY,
                `Structure field '${duplicate}' is repeated.`,
                node.token,
            );
        }

        return node.rows.map(row => {
            if (row.length !== node.fields.length) {
                deonError(
                    DiagnosticCode.STRUCTURE_ARITY,
                    `Structure row has ${row.length} cells; expected ${node.fields.length}.`,
                    node.token,
                );
            }

            const result: Record<string, DeonValue> = {};

            node.fields.forEach((field, index) => {
                setOrdered(result, field, this.value(row[index], locals));
            });

            return result;
        });
    }


    private map(
        node: MapNode,
        locals: Locals,
    ) {
        const result: Record<string, DeonValue> = {};

        for (const entry of node.entries) {
            if (entry.type === 'entry') {
                setOrdered(result, entry.name, this.value(entry.value, locals));
                continue;
            }

            // The shortened form takes its receiving key from the last segment of the link.
            if (entry.type === 'link-entry') {
                const value = entry.value.type === 'call'
                    ? this.call(
                        entry.value.reference,
                        entry.value.arguments,
                        entry.value.token,
                        locals,
                    )
                    : clone(
                        this.reference(entry.value.reference, entry.value.token, locals),
                    );

                const reference = entry.value.reference;
                const segment = reference.access.length
                    ? reference.access[reference.access.length - 1].name
                    : reference.head;
                const key = segment.startsWith('$') ? segment.slice(1) : segment;

                setOrdered(result, key, value);
                continue;
            }

            const spread = this.reference(entry.reference, entry.token, locals);

            // A string spreads into a map under its decimal character indices.
            if (typeof spread === 'string') {
                const points = Array.from(spread);

                // Copying those code points is expansion, counted against the budget (specification 11).
                this.charge(points.length);

                points.forEach((character, index) => {
                    setOrdered(result, String(index), character);
                });
            } else if (!Array.isArray(spread)) {
                for (const [key, value] of Object.entries(spread)) {
                    setOrdered(result, key, clone(value));
                }
            } else {
                deonError(
                    DiagnosticCode.TYPE_MISMATCH,
                    'A map can spread only a map or string.',
                    entry.token,
                );
            }
        }

        return result;
    }


    /**
     * A declaration is evaluated once and remembered, and a declaration that is already being
     * evaluated is a cycle.
     */
    private resolveName(
        name: string,
        token: Token,
    ) {
        if (this.cache.has(name)) {
            return this.cache.get(name) as DeonValue;
        }

        const declaration = this.declarations.get(name);

        if (!declaration) {
            deonError(
                DiagnosticCode.UNRESOLVED_LINK,
                `Unknown leaflink '${name}'.`,
                token,
            );
        }

        if (this.resolving.includes(name)) {
            deonError(
                DiagnosticCode.CYCLE,
                `Leaflink cycle: ${[...this.resolving, name].join(' -> ')}.`,
                token,
            );
        }

        this.resolving.push(name);

        try {
            const value = this.value(declaration.value, new Map());
            this.cache.set(name, value);

            return value;
        } finally {
            this.resolving.pop();
        }
    }


    /**
     * Reads a link: a local, an environment name, or a leaflink, followed by the segments that
     * navigate into it.
     */
    private reference(
        reference: Reference,
        token: Token,
        locals: Locals,
    ) {
        const name = reference.head;

        if (!name) {
            deonError(
                DiagnosticCode.UNRESOLVED_LINK,
                'A link requires a name.',
                token,
            );
        }

        let value: DeonValue;

        if (name.startsWith('$')) {
            const environmentName = name.slice(1);

            // An absent environment name is the empty string, never an error. Only the environment
            // supplied to the parse is read; the host process environment is never consulted, so a
            // document cannot reach a host secret it was not handed (specification 6).
            value = this.options.environment?.[environmentName] ?? '';
        } else if (locals.has(name)) {
            value = locals.get(name) as string;
        } else {
            value = this.resolveName(name, token);
        }

        for (const segment of reference.access) {
            if (Array.isArray(value)) {
                // A list is reached only by a decimal-digit bracket. A dot, a quoted bracket, or a
                // non-digit bracket is a key, which a list has none of; an index past its end — or too
                // large to represent — names no position it holds (specification 6).
                if (!segment.byIndex || segment.index >= value.length) {
                    deonError(
                        DiagnosticCode.UNRESOLVED_LINK,
                        `A list has no position '${segment.name}'.`,
                        token,
                    );
                }

                value = value[segment.index];
            } else if (typeof value !== 'string' && own(value, segment.name)) {
                value = value[segment.name];
            } else {
                deonError(
                    DiagnosticCode.UNRESOLVED_LINK,
                    `Missing access segment '${segment.name}'.`,
                    token,
                );
            }
        }

        return value;
    }


    /**
     * Charges a substitution against the expansion budget and stops the moment it is overrun
     * (specification 11). The check comes after every addition, so the very code point that crosses
     * the limit ends evaluation — the runaway value is never finished, which is the whole point of a
     * budget rather than a size check on the result. The stop is anchored at the document start, a
     * synthetic span at UTF-8 byte 0, line 1, column 1: the blow-up has no single culprit token, so
     * it is reported against the document as a whole.
     */
    private charge(
        points: number,
    ) {
        this.expansion += points;

        if (this.expansion > this.options.expansion) {
            deonError(
                DiagnosticCode.LIMIT_EXCEEDED,
                `Expansion budget exceeded: substitution produced more than `
                    + `${this.options.expansion} code points.`,
                new Token(TokenType.EOF, '', null, 1, 1, 0, 0, this.options.sourceName ?? '<memory>'),
            );
        }
    }


    /**
     * Every `#{reference}` is replaced. The sentinel left behind by an escaped opener is turned
     * back into text last, so that what it stands for is never itself resolved.
     */
    private interpolate(
        input: string,
        token: Token,
        locals: Locals,
    ) {
        const output = input.replace(/#\{([^}]+)\}/g, (_match, raw: string) => {
            // The reference was validated when it was scanned (specification 10), so it carries no
            // surrounding whitespace and parses cleanly here.
            const value = this.reference(parseReference(raw).reference, token, locals);

            if (typeof value !== 'string') {
                deonError(
                    DiagnosticCode.TYPE_MISMATCH,
                    'Interpolation requires a string value.',
                    token,
                );
            }

            // The substituted code points are expansion — text the document did not write literally —
            // and the budget counts exactly these. Charging inside the replacement stops a runaway
            // before the surrounding output string is assembled.
            this.charge(Array.from(value).length);

            return value;
        });

        return output.split(ESCAPED_INTERPOLATION).join('#{');
    }


    /**
     * Calls an entity. The interpolation names it carries are its exact parameter set, so an
     * argument that is missing, extra, repeated, or not a string is an error.
     */
    private call(
        reference: Reference,
        args: { name: string; value: ValueNode; token: Token }[],
        token: Token,
        outerLocals: Locals,
    ) {
        const declaration = this.declarations.get(reference.head);

        if (!declaration) {
            deonError(
                DiagnosticCode.UNRESOLVED_LINK,
                `Unknown entity '${reference.head}'.`,
                token,
            );
        }

        const target = this.staticTarget(declaration.value, reference.access, token);
        const parameters = this.parameters(target);
        const locals = new Map<string, string>();

        for (const argument of args) {
            if (locals.has(argument.name)) {
                deonError(
                    DiagnosticCode.ENTITY_ARGUMENT,
                    `Entity argument '${argument.name}' is repeated.`,
                    token,
                    [argument.token],
                );
            }

            const value = this.value(argument.value, outerLocals);

            if (typeof value !== 'string') {
                deonError(
                    DiagnosticCode.ENTITY_ARGUMENT,
                    `Entity argument '${argument.name}' must be a string.`,
                    token,
                    [argument.token],
                );
            }

            locals.set(argument.name, value);
        }

        const missing = [...parameters].filter(parameter => !locals.has(parameter));
        const extra = [...locals.keys()].filter(name => !parameters.has(name));

        if (missing.length || extra.length) {
            // A missing parameter has nowhere to point, so only the extra (unknown) arguments
            // contribute related spans, taken in source order at each one's name.
            const extraTokens = args
                .filter(argument => extra.includes(argument.name))
                .map(argument => argument.token);

            deonError(
                DiagnosticCode.ENTITY_ARGUMENT,
                `Entity arguments do not match; missing [${missing.join(', ')}], `
                    + `extra [${extra.join(', ')}].`,
                token,
                extraTokens,
            );
        }

        const callName = [reference.head, ...reference.access.map(segment => segment.name)].join('.');

        if (this.calling.includes(callName)) {
            deonError(
                DiagnosticCode.CYCLE,
                `Recursive entity call '${callName}'.`,
                token,
            );
        }

        this.calling.push(callName);

        try {
            // Every call evaluates an independent copy.
            return clone(this.value(target, locals));
        } finally {
            this.calling.pop();
        }
    }


    /**
     * Navigates into the syntax of a called entity, rather than into its value, because the value
     * cannot be evaluated before the arguments are known.
     */
    private staticTarget(
        node: ValueNode,
        access: AccessSegment[],
        token: Token,
    ): ValueNode {
        let target = node;

        for (const segment of access) {
            if (target.type === 'map') {
                const entries = target.entries.filter(
                    entry => entry.type === 'entry' && entry.name === segment.name,
                );

                if (!entries.length) {
                    deonError(
                        DiagnosticCode.UNRESOLVED_LINK,
                        `Missing entity access segment '${segment.name}'.`,
                        token,
                    );
                }

                // The last write to the key is the one that holds.
                target = (entries[entries.length - 1] as Extract<
                    MapNode['entries'][number],
                    { type: 'entry' }
                >).value;
                continue;
            }

            if (target.type === 'list' && segment.byIndex) {
                const item = target.items[segment.index];

                if (!item || item.type === 'spread-item') {
                    deonError(
                        DiagnosticCode.UNRESOLVED_LINK,
                        `Invalid entity list access '[${segment.name}]'.`,
                        token,
                    );
                }

                target = item;
                continue;
            }

            deonError(
                DiagnosticCode.UNRESOLVED_LINK,
                `Cannot access entity segment '${segment.name}'.`,
                token,
            );
        }

        return target;
    }


    private parameters(
        node: ValueNode,
    ) {
        return entityParameters(node);
    }
}


/**
 * The parameters of an entity are the interpolation names written inside it. An environment name is
 * read from the environment rather than passed in, so it is not one of them (specification 11).
 *
 * This sits outside the evaluator, and is exported, because it is a rule of the language rather than
 * a detail of evaluation: it is syntactic, it needs no capabilities, and anything that wants to know
 * what a `#name(...)` call would demand — an editor, a prompt server — must ask exactly this question
 * rather than answer it a second time and drift.
 */
export const entityParameters = (
    node: ValueNode,
) => {
    const parameters = new Set<string>();

    const visit = (
        value: ValueNode,
    ) => {
        if (value.type === 'scalar') {
            for (const match of value.value.matchAll(/#\{([^}]+)\}/g)) {
                const name = parseReference(match[1]).reference.head;

                if (name && !name.startsWith('$')) {
                    parameters.add(name);
                }
            }
        } else if (value.type === 'map') {
            for (const entry of value.entries) {
                if (entry.type === 'entry') {
                    visit(entry.value);
                } else if (entry.type === 'link-entry' && entry.value.type === 'call') {
                    for (const argument of entry.value.arguments) {
                        visit(argument.value);
                    }
                }
            }
        } else if (value.type === 'list') {
            for (const item of value.items) {
                if (item.type !== 'spread-item') {
                    visit(item);
                }
            }
        } else if (value.type === 'structure') {
            for (const row of value.rows) {
                for (const cell of row) {
                    visit(cell);
                }
            }
        } else if (value.type === 'call') {
            for (const argument of value.arguments) {
                visit(argument.value);
            }
        }
    };

    visit(node);

    return parameters;
}



/**
 * A fetcher that can reach nothing at all, so that an interpreter built without one cannot read
 * the filesystem or the network by accident.
 */
const denyAll = {
    asynchronous: async () => undefined,
    synchronous: () => undefined,
};



class Interpreter {
    private readonly Deon: any;
    private readonly fetcher: any;
    private readonly pure: boolean;
    private evaluator: Evaluator | undefined;

    constructor(
        Deon?: any,
        fetcher?: any,
        options?: { pure?: boolean },
    ) {
        this.Deon = Deon;
        this.fetcher = fetcher ?? denyAll;
        this.pure = options?.pure ?? false;
    }


    public async interpret(
        document: DocumentNode,
        interpreterOptions: DeonInterpreterOptions,
    ) {
        validateDeclarations(document);

        const options = this.options(interpreterOptions);
        const materialized = await this.materializeAsync(document, interpreterOptions, options);

        this.evaluator = new Evaluator(materialized, options);

        return this.evaluator.evaluate();
    }


    public interpretSynchronous(
        document: DocumentNode,
        interpreterOptions: DeonInterpreterOptions,
    ) {
        validateDeclarations(document);

        const options = this.options(interpreterOptions);
        const materialized = this.materializeSync(document, interpreterOptions, options);

        this.evaluator = new Evaluator(materialized, options);

        return this.evaluator.evaluate();
    }


    /**
     * The evaluated declaration namespace of the last interpreted document. Editor tooling reads
     * this through the `internals` export to drive leaflink completion.
     */
    public getLeaflinks(): Record<string, DeonValue> {
        return this.evaluator ? this.evaluator.leaflinks() : {};
    }


    /**
     * A pure interpreter never grants filesystem access, whatever it is asked for.
     */
    private options(
        interpreterOptions: DeonInterpreterOptions,
    ): RuntimeOptions {
        const input = interpreterOptions.parseOptions ?? {};

        return {
            ...deonParseOptions,
            ...input,
            allowFilesystem: !this.pure
                && (input.allowFilesystem ?? deonParseOptions.allowFilesystem),
            allowNetwork: input.allowNetwork ?? deonParseOptions.allowNetwork,
            environment: input.environment ?? deonParseOptions.environment,
            resources: input.resources ?? deonParseOptions.resources,
            resourceStack: input.resourceStack ?? deonParseOptions.resourceStack,
            // Absent or zero means the host default, so the doubling blow-up is bounded even when no
            // budget is named (specification 11).
            expansion: input.expansion && input.expansion > 0
                ? input.expansion
                : deonParseOptions.expansion,
        };
    }


    /**
     * Loads every resource and puts its value back into the tree, so that the evaluation that
     * follows sees only leaflinks. A resource whose authenticator depends on another resource is
     * loaded after it.
     */
    private async materializeAsync(
        document: DocumentNode,
        interpreterOptions: DeonInterpreterOptions,
        options: RuntimeOptions,
    ) {
        const replacements = new Map<string, LeaflinkNode>();
        const resources = this.resources(document);
        const resolving: string[] = [];

        const resolve = async (
            declaration: ResourceNode,
        ): Promise<void> => {
            if (replacements.has(declaration.name)) {
                return;
            }

            if (resolving.includes(declaration.name)) {
                deonError(
                    DiagnosticCode.CYCLE,
                    `Resource dependency cycle: `
                        + `${[...resolving, declaration.name].join(' -> ')}.`,
                    declaration.token,
                );
            }

            resolving.push(declaration.name);

            try {
                const dependencies = this.resourceDependencies(document, declaration, resources);

                for (const dependency of dependencies) {
                    await resolve(resources.get(dependency) as ResourceNode);
                }

                const authenticator = this.authenticator(
                    document,
                    declaration,
                    replacements,
                    options,
                );

                const loaded = await this.loadAsync(
                    declaration,
                    interpreterOptions,
                    options,
                    authenticator,
                );

                replacements.set(declaration.name, {
                    type: 'leaflink',
                    name: declaration.name,
                    value: nodeFromValue(loaded, declaration.token),
                    token: declaration.token,
                });
            } finally {
                resolving.pop();
            }
        };

        for (const declaration of resources.values()) {
            await resolve(declaration);
        }

        return this.replaceResources(document, replacements);
    }


    private materializeSync(
        document: DocumentNode,
        interpreterOptions: DeonInterpreterOptions,
        options: RuntimeOptions,
    ) {
        const replacements = new Map<string, LeaflinkNode>();
        const resources = this.resources(document);
        const resolving: string[] = [];

        const resolve = (
            declaration: ResourceNode,
        ): void => {
            if (replacements.has(declaration.name)) {
                return;
            }

            if (resolving.includes(declaration.name)) {
                deonError(
                    DiagnosticCode.CYCLE,
                    `Resource dependency cycle: `
                        + `${[...resolving, declaration.name].join(' -> ')}.`,
                    declaration.token,
                );
            }

            resolving.push(declaration.name);

            try {
                const dependencies = this.resourceDependencies(document, declaration, resources);

                for (const dependency of dependencies) {
                    resolve(resources.get(dependency) as ResourceNode);
                }

                const authenticator = this.authenticator(
                    document,
                    declaration,
                    replacements,
                    options,
                );

                const loaded = this.loadSync(
                    declaration,
                    interpreterOptions,
                    options,
                    authenticator,
                );

                replacements.set(declaration.name, {
                    type: 'leaflink',
                    name: declaration.name,
                    value: nodeFromValue(loaded, declaration.token),
                    token: declaration.token,
                });
            } finally {
                resolving.pop();
            }
        };

        for (const declaration of resources.values()) {
            resolve(declaration);
        }

        return this.replaceResources(document, replacements);
    }


    private resources(
        document: DocumentNode,
    ) {
        const declarations = document.declarations.filter(
            (declaration): declaration is ResourceNode => declaration.type !== 'leaflink',
        );

        return new Map(
            declarations.map(declaration => [declaration.name, declaration]),
        );
    }


    /**
     * The resources an authenticator reaches for, directly or through the leaflinks it reads.
     */
    private resourceDependencies(
        document: DocumentNode,
        declaration: ResourceNode,
        resources: Map<string, ResourceNode>,
    ) {
        const dependencies = new Set<string>();

        if (!declaration.authenticator) {
            return dependencies;
        }

        const leaflinks = new Map(
            document.declarations
                .filter((entry): entry is LeaflinkNode => entry.type === 'leaflink')
                .map(entry => [entry.name, entry]),
        );

        const visited = new Set<string>();

        const reference = (
            value: Reference,
        ) => {
            const name = value.head;

            if (!name || name.startsWith('$')) {
                return;
            }

            if (resources.has(name)) {
                dependencies.add(name);
                return;
            }

            const leaflink = leaflinks.get(name);

            if (!leaflink || visited.has(name)) {
                return;
            }

            visited.add(name);
            visit(leaflink.value);
        };

        const visit = (
            value: ValueNode,
        ): void => {
            if (value.type === 'scalar') {
                for (const match of value.value.matchAll(/#\{([^}]+)\}/g)) {
                    reference(parseReference(match[1]).reference);
                }
            } else if (value.type === 'link') {
                reference(value.reference);
            } else if (value.type === 'call') {
                reference(value.reference);

                for (const argument of value.arguments) {
                    visit(argument.value);
                }
            } else if (value.type === 'map') {
                for (const entry of value.entries) {
                    if (entry.type === 'entry') {
                        visit(entry.value);
                    } else if (entry.type === 'spread-entry') {
                        reference(entry.reference);
                    } else if (entry.value.type === 'link') {
                        reference(entry.value.reference);
                    } else {
                        visit(entry.value);
                    }
                }
            } else if (value.type === 'list') {
                for (const item of value.items) {
                    if (item.type === 'spread-item') {
                        reference(item.reference);
                    } else {
                        visit(item);
                    }
                }
            } else {
                for (const row of value.rows) {
                    for (const cell of row) {
                        visit(cell);
                    }
                }
            }
        };

        visit(declaration.authenticator);

        return dependencies;
    }


    /**
     * Evaluates the `with` of a resource against the leaflinks, and the resources already loaded.
     */
    private authenticator(
        document: DocumentNode,
        declaration: ResourceNode,
        replacements: Map<string, LeaflinkNode>,
        options: RuntimeOptions,
    ) {
        if (!declaration.authenticator) {
            return undefined;
        }

        const available = document.declarations.flatMap(entry => {
            if (entry.type === 'leaflink') {
                return [entry];
            }

            return replacements.has(entry.name)
                ? [replacements.get(entry.name) as LeaflinkNode]
                : [];
        });

        const value = new Evaluator(
            { ...document, declarations: available },
            options,
        ).evaluateNode(declaration.authenticator);

        if (typeof value !== 'string') {
            deonError(
                DiagnosticCode.TYPE_MISMATCH,
                'A resource authenticator must resolve to a string.',
                declaration.token,
            );
        }

        return value;
    }


    private async loadAsync(
        declaration: ResourceNode,
        interpreterOptions: DeonInterpreterOptions,
        options: RuntimeOptions,
        authenticator?: string,
    ) {
        const virtual = this.virtualResource(declaration, interpreterOptions, options);
        const requestedTarget = this.resourceTarget(declaration, interpreterOptions);
        const token = authenticator ?? this.authorization(requestedTarget, options);

        let result: FetchResult | undefined;

        try {
            result = virtual ?? await this.fetcher.asynchronous(
                requestedTarget,
                { ...interpreterOptions, parseOptions: options },
                token,
                declaration.type,
            );
        } catch (failure) {
            // A fault the fetcher raises about a resource it did reach — an encoding it will not
            // accept — is reported at the statement that reached for it (§11.2), exactly as a fault
            // raised while parsing that resource is.
            throw this.reanchorImport(failure, declaration.token);
        }

        if (!result) {
            this.unavailableResource(declaration, options, requestedTarget);
        }

        // An injection keeps its target exactly, without parsing it.
        if (declaration.type === 'inject') {
            return result.data;
        }

        const filetype = result.filetype ?? this.extension(requestedTarget, declaration.type);

        if (filetype === '.json') {
            return this.jsonResource(declaration, result.data);
        }

        if (filetype !== '.deon') {
            deonError(
                DiagnosticCode.RESOURCE_FORMAT,
                `Unsupported import format '${filetype}'.`,
                declaration.token,
            );
        }

        const target = result.resourceId ?? requestedTarget;
        this.checkResourceCycle(target, declaration, options);

        const parseOptions = {
            ...options,
            sourceName: target,
            filebase: result.filebase ?? '',
            resourceStack: [...options.resourceStack, target],
        };

        try {
            return normalizeHostValue(
                await new this.Deon().parse(result.data, parseOptions),
            );
        } catch (failure) {
            throw this.reanchorImport(failure, declaration.token);
        }
    }


    private loadSync(
        declaration: ResourceNode,
        interpreterOptions: DeonInterpreterOptions,
        options: RuntimeOptions,
        authenticator?: string,
    ) {
        const virtual = this.virtualResource(declaration, interpreterOptions, options);
        const requestedTarget = this.resourceTarget(declaration, interpreterOptions);
        const token = authenticator ?? this.authorization(requestedTarget, options);

        let result: FetchResult | undefined;

        try {
            result = virtual ?? this.fetcher.synchronous(
                requestedTarget,
                { ...interpreterOptions, parseOptions: options },
                token,
                declaration.type,
            );
        } catch (failure) {
            // A fault the fetcher raises about a resource it did reach — an encoding it will not
            // accept — is reported at the statement that reached for it (§11.2), exactly as a fault
            // raised while parsing that resource is.
            throw this.reanchorImport(failure, declaration.token);
        }

        if (!result) {
            this.unavailableResource(declaration, options, requestedTarget);
        }

        if (declaration.type === 'inject') {
            return result.data;
        }

        const filetype = result.filetype ?? this.extension(requestedTarget, declaration.type);

        if (filetype === '.json') {
            return this.jsonResource(declaration, result.data);
        }

        if (filetype !== '.deon') {
            deonError(
                DiagnosticCode.RESOURCE_FORMAT,
                `Unsupported import format '${filetype}'.`,
                declaration.token,
            );
        }

        const target = result.resourceId ?? requestedTarget;
        this.checkResourceCycle(target, declaration, options);

        const parseOptions = {
            ...options,
            sourceName: target,
            filebase: result.filebase ?? '',
            resourceStack: [...options.resourceStack, target],
        };

        try {
            return normalizeHostValue(
                new this.Deon().parseSynchronous(result.data, parseOptions),
            );
        } catch (failure) {
            throw this.reanchorImport(failure, declaration.token);
        }
    }


    /**
     * A fault inside an imported document is reported at the statement that imported it (§11.2): the
     * document a caller is holding is the importing one, and the line they can go and look at is the
     * import. A cycle keeps its own span — it is reported at the reference that closes it, not at
     * every statement it was reached through.
     */
    private reanchorImport(
        failure: unknown,
        token: Token,
    ) {
        if (failure instanceof DeonError && failure.code !== DiagnosticCode.CYCLE) {
            return new DeonError(failure.code, failure.message, token);
        }

        return failure;
    }


    /**
     * A resource supplied through the `resources` option, which is how a test, or an editor, hands
     * over a document without touching the filesystem or the network at all.
     *
     * The `absolutePaths` mapping is applied here as well as on the filesystem, because it maps a
     * logical target onto the host path that holds it (specification 9), and a document must not
     * mean one thing when its resources are handed over and another when they are read from a disk.
     */
    private virtualResource(
        declaration: ResourceNode,
        interpreterOptions: DeonInterpreterOptions,
        options: RuntimeOptions,
    ): FetchResult | undefined {
        const target = this.resourceTarget(declaration, interpreterOptions);
        const mapped = resolveMappedAbsolutePath(target, options.absolutePaths ?? {});

        const data = options.resources?.[mapped]
            ?? options.resources?.[target]
            ?? options.resources?.[declaration.target];

        if (data === undefined) {
            return undefined;
        }

        return {
            data,
            filetype: this.extension(mapped, declaration.type),
            filebase: mapped.includes('/') ? mapped.slice(0, mapped.lastIndexOf('/')) : '',
            resourceId: mapped,
        };
    }


    /**
     * A resource that could not be read was either denied or unreachable, and the two must not be
     * confused: one is a decision, the other an accident.
     */
    private unavailableResource(
        declaration: ResourceNode,
        options: RuntimeOptions,
        target: string,
    ): never {
        const remote = target.startsWith('http://') || target.startsWith('https://');
        const allowed = remote ? options.allowNetwork : options.allowFilesystem;

        // Which capability was refused is known right here, and saying so is the difference between a
        // reader who fixes it and one who goes looking. The code says a decision was taken; only the
        // message can say which.
        const capability = remote ? 'network' : 'filesystem';

        return deonError(
            allowed ? DiagnosticCode.RESOURCE_IO : DiagnosticCode.CAPABILITY_DENIED,
            allowed
                ? `Unable to load resource '${declaration.target}'.`
                : `The resource '${declaration.target}' was not permitted: ${capability} access is not allowed.`,
            declaration.token,
        );
    }


    private jsonResource(
        declaration: ResourceNode,
        data: string,
    ) {
        try {
            return parseJSON(data);
        } catch {
            return deonError(
                DiagnosticCode.RESOURCE_FORMAT,
                `Invalid JSON resource '${declaration.target}'.`,
                declaration.token,
            );
        }
    }


    private checkResourceCycle(
        target: string,
        declaration: ResourceNode,
        options: RuntimeOptions,
    ) {
        if (options.resourceStack.includes(target)) {
            deonError(
                DiagnosticCode.CYCLE,
                `Resource cycle: ${[...options.resourceStack, target].join(' -> ')}.`,
                declaration.token,
            );
        }
    }


    /**
     * The canonical identity of a resource. A relative filesystem target resolves against the file
     * that holds it, a relative URL against the URL that holds it, and `..` is folded away so that
     * two spellings of one resource cannot escape the cycle check.
     */
    private resourceTarget(
        declaration: ResourceNode,
        interpreterOptions: DeonInterpreterOptions,
    ) {
        const target = this.withImportExtension(declaration.target, declaration.type);

        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target)) {
            return new URL(target).href;
        }

        const source = interpreterOptions.parseOptions?.sourceName
            ?? interpreterOptions.file
            ?? '';
        const filebase = interpreterOptions.parseOptions?.filebase ?? '';

        const urlBase = /^https?:\/\//i.test(filebase)
            ? `${filebase.replace(/\/$/, '')}/`
            : /^https?:\/\//i.test(source)
                ? source
                : '';

        if (urlBase) {
            return new URL(target, urlBase).href;
        }

        const normalizedTarget = target.replace(/\\/g, '/');
        const absolute = normalizedTarget.startsWith('/')
            || /^[A-Za-z]:\//.test(normalizedTarget);

        const sourceBase = source.includes('/')
            ? source.slice(0, source.lastIndexOf('/'))
            : '';
        const base = filebase || sourceBase;

        const joined = absolute
            ? normalizedTarget
            : `${base ? `${base}/` : ''}${normalizedTarget}`;

        const drive = joined.match(/^[A-Za-z]:/)?.[0] ?? '';
        const rooted = joined.startsWith('/') || Boolean(drive);
        const parts = joined.slice(drive.length).split('/');

        const normalized: string[] = [];

        for (const part of parts) {
            if (!part || part === '.') {
                continue;
            }

            if (part === '..') {
                // Above the root there is nothing, so a rooted path drops what it cannot climb.
                if (normalized.length && normalized[normalized.length - 1] !== '..') {
                    normalized.pop();
                } else if (!rooted) {
                    normalized.push(part);
                }
            } else {
                normalized.push(part);
            }
        }

        return `${drive}${joined.startsWith('/') ? '/' : ''}${normalized.join('/')}`;
    }


    /**
     * An import target with no extension is a Deon document. The query and the fragment are not
     * part of the path, so the extension goes before them.
     */
    private withImportExtension(
        target: string,
        type: ResourceNode['type'],
    ) {
        if (type !== 'import') {
            return target;
        }

        const suffixIndex = target.search(/[?#]/);
        const pathname = suffixIndex === -1 ? target : target.slice(0, suffixIndex);
        const suffix = suffixIndex === -1 ? '' : target.slice(suffixIndex);
        const slash = Math.max(pathname.lastIndexOf('/'), pathname.lastIndexOf('\\'));

        if (pathname.lastIndexOf('.') > slash) {
            return target;
        }

        return `${pathname}.deon${suffix}`;
    }


    private extension(
        target: string,
        type: ResourceNode['type'],
    ) {
        if (type === 'inject') {
            return '';
        }

        const clean = target.split(/[?#]/, 1)[0];
        const slash = clean.lastIndexOf('/');
        const dot = clean.lastIndexOf('.');

        return dot > slash ? clean.slice(dot).toLowerCase() : '.deon';
    }


    /**
     * The `authorization` option is keyed by an exact lowercase hostname.
     */
    private authorization(
        target: string,
        options: RuntimeOptions,
    ) {
        if (!/^https?:\/\//i.test(target)) {
            return undefined;
        }

        const hostname = new URL(target).hostname.toLowerCase();

        return options.authorization?.[hostname];
    }


    private replaceResources(
        document: DocumentNode,
        replacements: Map<string, LeaflinkNode>,
    ) {
        return {
            ...document,
            declarations: document.declarations.map(declaration => declaration.type === 'leaflink'
                ? declaration
                : replacements.get(declaration.name) as LeaflinkNode),
        };
    }
}
// #endregion module



// #region exports
export {
    Evaluator,
    normalizeHostValue,
};

export default Interpreter;
// #endregion exports
