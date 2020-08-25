// #region imports
    // #region external
    import {
        TokenType,
    } from '../../data/enumerations';

    import Token from '../Token';
    import Deon from '../Deon';
    // #endregion external
// #endregion imports



// #region module
class Scanner {
    private source: string;
    private tokens: Token[];
    private start: number = 0;
    private current: number = 0;
    private line: number = 1;

    constructor(
        source: string,
    ) {
        this.source = source;
        this.tokens = [];
    }

    public scanTokens() {
        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.endScan();

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
            case '/':
                if (this.match('/')) {
                    // A comment goes until the end of the line.
                    while (this.peek() !== '\n' && !this.isAtEnd()) {
                        this.advance();
                    }
                } else {
                    if (this.match('*')) {
                        // A multline comment goes until starslash (*/).
                        while (this.peek() !== '*' && !this.isAtEnd()) {
                            this.advance();
                        }
                    }
                }
                break;
            case '*':
                if (this.match('/')) {
                    // End of multiline comment.
                    this.advance();
                }
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
                    Deon.error(this.line, 'Unexpected character.');
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

        const newToken = new Token(type, text, literal, this.line);

        this.tokens.push(newToken);
    }


    private singlelineString() {
        while (this.peek() !== '\'' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line += 1;

                Deon.error(this.line, 'Unterminated string.');
                return;
            }

            this.advance();
        }

        // Unterminated string.
        if (this.isAtEnd()) {
            Deon.error(this.line, 'Unterminated string.');
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
            Deon.error(this.line, 'Unterminated string.');
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
            Deon.error(this.line, 'Unterminated link.');
            return;
        }

        // Extract the value without the initial hash (#).
        const value = this.source.substring(this.start + 1, this.current);
        this.addTokenLiteral(TokenType.LINK, value);
    }

    private signifier() {
        while (this.isAlphaNumeric(this.peek())) {
            this.advance();
        }

        this.addToken(TokenType.SIGNIFIER);
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
            || c === '-';
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
}
// #endregion module



// #region exports
export default Scanner;
// #endregion exports
