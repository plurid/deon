// #region imports
    // #region external
    import {
        nonAlphanumericCharacters,
        INTERNAL_INTERPOLATOR_SIGN,
    } from '../../data/constants';

    import {
        TokenType,
    } from '../../data/enumerations';

    import Token from '../Token';

    import {
        inGroupClassify,
    } from '../../utilities/general';
    // #endregion external


    // #region internal
    import Identifier from './Identifier';
    // #endregion internal
// #endregion imports



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
            inject: TokenType.INJECT,
            from: TokenType.FROM,
            with: TokenType.WITH,
        };
    }

    public scanTokens() {
        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.endScan();
        // console.log('this.tokens', this.tokens);

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
                this.hash();
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
                this.signifier();
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
        while (
            (this.peek() !== '\'' || this.peek() === '\\')
            && !this.isAtEnd()
        ) {
            if (this.peek() === '\n') {
                this.line += 1;

                this.deonError(this.line, 'Unterminated string.');
                return;
            }

            if (this.peek() === '\\') {
                this.advanceEscaped();
            } else {
                this.advance();
            }
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
        while (
            (this.peek() !== '`' || this.peek() === '\\')
            && !this.isAtEnd()
        ) {
            if (this.peek() === '\n') {
                this.line += 1;
                this.advance();
                continue;
            }

            if (this.peek() === '\\') {
                this.advanceEscaped();
            } else {
                this.advance();
            }
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

    private hash() {
        if (this.match('{')) {
            // Handle interpolation.
            while (
                this.peek() !== '}'
                && this.peek() !== '\n'
                && !this.isAtEnd()
            ) {
                this.advance();
            }

            if (this.isAtEnd()) {
                this.deonError(this.line, 'Unterminated interpolation.');
                return;
            }

            // The closing last bracket }.
            this.advance();

            // Extract the value without the initial hashbracket #{
            // and without the last bracket }.
            const value = this.source.substring(this.start + 2, this.current - 1);
            this.addTokenLiteral(
                TokenType.INTERPOLATE,
                INTERNAL_INTERPOLATOR_SIGN + value,
            );
            return;
        }

        if (this.match('\'')) {
            // Handle link string.
            while (this.peek() !== '\'' && !this.isAtEnd()) {
                if (this.peek() === '\n') {
                    this.line += 1;

                    this.deonError(this.line, 'Unterminated link string.');
                    return;
                }

                this.advance();
            }

            // Unterminated link string.
            if (this.isAtEnd()) {
                this.deonError(this.line, 'Unterminated link string.');
                return;
            }

            // The closing string mark '.
            this.advance();

            // Extract the value without the initial hashstring #'
            // and without the last string mark '.
            const value = this.source.substring(this.start + 2, this.current - 1);
            this.addTokenLiteral(TokenType.LINK, value);
            return;
        }

        // Handle link.
        while (
            this.peek() !== ' '
            && this.peek() !== '\n'
            && !this.isAtEnd()
        ) {
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
                    this.spread();
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

    private spread() {
        if (this.match('\'')) {
            // Handle link string spread.
            while (this.peek() !== '\'' && !this.isAtEnd()) {
                if (this.peek() === '\n') {
                    this.line += 1;

                    this.deonError(this.line, 'Unterminated link string spread.');
                    return;
                }

                this.advance();
            }

            // Unterminated link string spread.
            if (this.isAtEnd()) {
                this.deonError(this.line, 'Unterminated link string spread.');
                return;
            }

            // The closing '.
            this.advance();

            // Extract the value without the initial hashstring (#')
            // and without the last string mark.
            const value = this.source.substring(this.start + 5, this.current - 1);
            this.addTokenLiteral(TokenType.SPREAD, value);
            return;
        }


        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        const text = this.source.substring(this.start, this.current);
        this.addTokenLiteral(TokenType.SPREAD, text);
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
        while (
            this.isAlphaNumeric(this.peek())
            && !this.isAtEnd()
        ) {
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
            case TokenType.INJECT: {
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
            case TokenType.WITH: {
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
        const identifier = new Identifier(this.tokens);
        const tokens = identifier.identify();

        this.tokens = [
            ...tokens,
        ];
    }



    // Utilities
    private advance() {
        this.current += 1;
        return this.source.charAt(this.current - 1);
    }

    private advanceEscaped() {
        this.current += 2;
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

    private isAlpha(
        c: string,
    ) {
        return (c >= 'a' && c <= 'z')
            || (c >= 'A' && c <= 'Z')
            || c === '_'
            || c === '-'
            || c === '.'
            || c === '/'
            || c === '['
            || c === ']'
            || c === '$'
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
        return !nonAlphanumericCharacters.includes(c);
    }

    private isAtEnd() {
        return this.current >= this.source.length;
    }

    private inGroup(
        position: number,
    ) {
        const tokens = this.tokens
            .slice(0, position)
            .reverse();

        return inGroupClassify(
            tokens,
        );
    }
}
// #endregion module



// #region exports
export default Scanner;
// #endregion exports
