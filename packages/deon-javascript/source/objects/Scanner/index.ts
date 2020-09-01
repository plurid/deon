// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import Token from '../Token';
    // #endregion external
// #endregion imports

export type ScanMode = 'MAP' | 'LIST';

// #region module
class Scanner {
    private source: string;
    private tokens: Token[];
    private start: number = 0;
    private current: number = 0;
    private line: number = 1;
    private keywords: Record<string, TokenType>;
    private deonError: any;

    constructor(
        source: string,
        error: any,
    ) {
        this.source = source;
        this.tokens = [];
        this.deonError = error;

        this.keywords = {
            import: TokenType.IMPORT,
            from: TokenType.FROM,
        };
    }

    public scanTokens() {
        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.endScan();

        this.identify();

        return this.tokens;
    }


    private scanToken() {
        const character = this.advance();

        switch (character) {
            case '[':
                this.addToken(TokenType.LEFT_SQUARE_BRACKET);
                break;
            case ']':
                this.addToken(TokenType.RIGHT_SQUARE_BRACKET);
                break;
            case '{':
                this.addToken(TokenType.LEFT_CURLY_BRACKET);
                break;
            case '}':
                this.addToken(TokenType.RIGHT_CURLY_BRACKET);
                break;
            case ',':
                this.addToken(TokenType.COMMA);
                break;
            case '#':
                this.link();
                break;
            case '.':
                this.dot();
                break;
            case '/':
                this.slash();
                break;
            case '*':
                this.star();
                break;

            case ' ':
            case '\r':
            case '\t':
                // Ignore whitespace.
                break;

            case '\'':
                this.singlelineString();
                break;
            case '`':
                this.multilineString();
                break;
            case '\n':
                this.line++;
                break;

            default:
                if (this.isAlphaNumeric(character)) {
                    this.signifier();
                } else {
                    this.deonError(this.line, 'Unexpected character.');
                }
                break;
        }
    }


    private addToken(
        type: TokenType,
    ) {
        this.addTokenLiteral(type, null);
    }

    private addTokenLiteral(
        type: TokenType,
        literal: any,
    ) {
        const text = this.source.substring(this.start, this.current);

        const newToken = new Token(
            type,
            text,
            literal,
            this.line,
        );

        this.tokens.push(newToken);
    }


    private singlelineString() {
        while (this.peek() !== '\'' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line += 1;

                this.deonError(this.line, 'Unterminated string.');
                return;
            }

            this.advance();
        }

        // Unterminated string.
        if (this.isAtEnd()) {
            this.deonError(this.line, 'Unterminated string.');
            return;
        }

        // The closing '.
        this.advance();

        const value = this.source.substring(this.start + 1, this.current - 1);
        this.addTokenLiteral(TokenType.STRING, value);
    }

    private multilineString() {
        while (this.peek() !== '`' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line += 1;
            }

            this.advance();
        }

        // Unterminated string.
        if (this.isAtEnd()) {
            this.deonError(this.line, 'Unterminated string.');
            return;
        }

        // The closing '.
        this.advance();

        const value = this.source.substring(this.start + 1, this.current - 1).trim();
        this.addTokenLiteral(TokenType.STRING, value);
    }

    private link() {
        while (this.peek() !== ' ' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line += 1;

                break;
            }

            this.advance();
        }

        // Unterminated link.
        if (this.isAtEnd()) {
            this.deonError(this.line, 'Unterminated link.');
            return;
        }

        // Extract the value without the initial hash (#).
        const value = this.source.substring(this.start + 1, this.current);
        this.addTokenLiteral(TokenType.LINK, value);
    }

    private dot() {
        if (this.match('.')) {
            if (this.match('.')) {
                if (this.match('#')) {
                    this.tripleDot();
                } else {
                    this.deonError(this.line, 'Can only spread leaflinks.');
                }
            } else {
                this.signifier();
            }
        } else {
            this.signifier();
        }
    }

    private tripleDot() {
        this.addToken(TokenType.TRIPLE_DOT);
    }

    private slash() {
        if (this.match('/')) {
            // A comment goes until the end of the line.
            while (this.peek() !== '\n' && !this.isAtEnd()) {
                this.advance();
            }
        } else if (this.match('*')) {
            // A multline comment goes until starslash (*/).
            while (this.peek() !== '*' && !this.isAtEnd()) {
                this.advance();
            }
        } else {
            this.signifier();
        }
    }

    private star() {
        if (this.match('/')) {
            // End of multiline comment.
            this.advance();
        }
    }

    private signifier() {
        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        // See if the signifier is a reserved word.
        const text = this.source.substring(this.start, this.current);
        let type = this.keywords[text];

        if (!type) {
            type = TokenType.SIGNIFIER;
        }

        switch (type) {
            case TokenType.IMPORT: {
                const inGroup = this.inGroup(this.tokens.length - 1);

                if (
                    inGroup
                    && inGroup !== 'LEAFLINK'
                ) {
                    type = TokenType.SIGNIFIER;
                    break;
                }

                break;
            }
            case TokenType.FROM: {
                const inGroup = this.inGroup(this.tokens.length - 1);

                if (
                    inGroup
                    && inGroup !== 'LEAFLINK'
                ) {
                    type = TokenType.SIGNIFIER;
                    break;
                }

                break;
            }
        }

        this.addToken(type);
    }

    private endScan() {
        const endOfFile = new Token(
            TokenType.EOF,
            '',
            null,
            this.line,
        );

        this.tokens.push(endOfFile);
    }

    private identify() {
        const tokens: Token[] = [];
        let mode = '';
        let mapLookup = false;
        let mapItemLine = -1;
        let listItemLine = -1;
        let temporary: Token[] = [];

        const stringifyTemporary = () => {
            if (temporary.length > 0) {
                const stringToken = this.stringFromSignifiers(temporary);
                tokens.push(stringToken);

                temporary = [];
            }
        }

        const identifySignifier = (
            index: number,
            token: Token,
        ) => {
            const inGroup = this.inGroup(index);

            switch (inGroup) {
                case 'MAP':
                case 'LEAFLINK': {
                    const identifierToken = this.identifierFromSignifier(token);
                    tokens.push(identifierToken);
                    return;
                }
            }

            tokens.push(token);
        }

        const identifyLeaflink = (
            token: Token,
        ) => {
            const lastToken = tokens[tokens.length - 1];

            if (!lastToken) {
                const identifierToken = this.identifierFromSignifier(token);
                tokens.push(identifierToken);
                return;
            }

            if (
                lastToken.line === token.line
                && lastToken.type === TokenType.IDENTIFIER
                && token.type === TokenType.SIGNIFIER
            ) {
                const stringToken = this.stringFromSignifiers([token]);
                tokens.push(stringToken);
                return;
            }

            const identifierToken = this.identifierFromSignifier(token);
            tokens.push(identifierToken);
        }

        for (const [index, token] of this.tokens.entries()) {
            switch (token.type) {
                case TokenType.LEFT_CURLY_BRACKET:
                    mode = 'MAP';
                    break;
                case TokenType.RIGHT_CURLY_BRACKET: {
                    const inGroup = this.inGroup(index + 1);
                    if (inGroup === 'MAP' || inGroup === 'LIST') {
                        mode = inGroup;
                    } else {
                        mode = '';
                    }
                    break;
                }
                case TokenType.LEFT_SQUARE_BRACKET:
                    mode = 'LIST';
                    break;
                case TokenType.RIGHT_SQUARE_BRACKET: {
                    const inGroup = this.inGroup(index + 1);
                    if (inGroup === 'MAP' || inGroup === 'LIST') {
                        mode = inGroup;
                    } else {
                        mode = '';
                    }
                    break;
                }
            }

            if (
                token.type !== TokenType.SIGNIFIER
                && token.type !== TokenType.STRING
            ) {
                stringifyTemporary();

                tokens.push(token);
                mapLookup = false;
                continue;
            }

            if (token.type === TokenType.STRING) {
                if (mode === 'LIST') {
                    stringifyTemporary();
                }

                tokens.push(token);
                continue;
            }

            if (mode === 'MAP') {
                if (mapLookup) {
                    if (mapItemLine === token.line) {
                        temporary.push(token);
                    } else {
                        stringifyTemporary();

                        identifySignifier(
                            index,
                            token,
                        );
                        mapItemLine = token.line;
                        temporary = [];
                    }
                } else {
                    mapLookup = true;
                    mapItemLine = token.line;

                    identifySignifier(
                        index,
                        token,
                    );
                }

                continue;
            }

            if (mode === 'LIST') {
                if (listItemLine === token.line) {
                    temporary.push(token);
                } else {
                    stringifyTemporary();

                    listItemLine = token.line;
                    temporary.push(token);
                }

                continue;
            }

            const inGroup = this.inGroup(index);

            if (inGroup === 'LEAFLINK') {
                identifyLeaflink(
                    token,
                );
                continue;
            }

            identifySignifier(
                index,
                token,
            );
        }

        this.tokens = [
            ...tokens,
        ];
    }



    // Utilities
    private advance() {
        this.current += 1;
        return this.source.charAt(this.current - 1);
    }

    private match(
        expected: string,
    ) {
        if (this.isAtEnd()) {
            return false;
        }

        if (this.source.charAt(this.current) !== expected) {
            return false;
        }

        this.current += 1;
        return true;
    }

    private peek() {
        if (this.isAtEnd()) {
            return '\0';
        }

        return this.source.charAt(this.current);
    }

    private peekNext() {
        if (this.current + 1 >= this.source.length) {
            return '\0';
        }

        return this.source.charAt(this.current + 1);
    }

    private isAlpha(
        c: string,
    ) {
        return (c >= 'a' && c <= 'z')
            || (c >= 'A' && c <= 'Z')
            || c === '_'
            || c === '-'
            || c === '.'
            || c === '/'
            || c === ':';
    }

    private isDigit(
        character: string,
    ) {
        return character >= '0' && character <= '9';
    }

    private isAlphaNumeric(
        c: string,
    ) {
        return this.isAlpha(c) || this.isDigit(c);
    }

    private isAtEnd() {
        return this.current >= this.source.length;
    }

    private stringFromSignifiers(
        tokens: Token[],
    ) {
        let texts: string[] = [];
        const line = tokens[0].line;

        for (const token of tokens) {
            texts.push(token.lexeme);
        }

        const text = texts.join(' ');

        const stringToken = new Token(
            TokenType.STRING,
            text,
            text,
            line,
        );

        return stringToken;
    }

    private identifierFromSignifier(
        token: Token,
    ) {
        const lexeme = token.lexeme.replace(/'/g, '');

        const identifierToken = new Token(
            TokenType.IDENTIFIER,
            lexeme,
            null,
            token.line,
        );

        return identifierToken;
    }

    private inGroup(
        position: number,
    ) {
        const tokens = this.tokens
            .slice(0, position)
            .reverse();

        if (tokens.length === 0) {
            return 'LEAFLINK';
        }

        const curlyBrackets = {
            left: 0,
            right: 0,
        };
        const squareBrackets = {
            left: 0,
            right: 0,
        };

        for (const token of tokens) {
            switch (token.type) {
                case TokenType.LEFT_CURLY_BRACKET:
                    curlyBrackets.left += 1;
                    break;
                case TokenType.RIGHT_CURLY_BRACKET:
                    curlyBrackets.right += 1;
                    break;
                case TokenType.LEFT_SQUARE_BRACKET:
                    squareBrackets.left += 1;
                    break;
                case TokenType.RIGHT_SQUARE_BRACKET:
                    squareBrackets.right += 1;
                    break;
            }

            if (curlyBrackets.left > curlyBrackets.right) {
                return 'MAP';
            }

            if (squareBrackets.left > squareBrackets.right) {
                return 'LIST';
            }
        }

        /**
         * TODO
         * to find a less expensive way to check for leaflinks
         */
        if (
            curlyBrackets.left === curlyBrackets.right
            && squareBrackets.left === squareBrackets.right
        ) {
            return 'LEAFLINK';
        }

        return;
    }
}
// #endregion module



// #region exports
export default Scanner;
// #endregion exports
