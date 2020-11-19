// #region imports
    // #region external
    import {
        TokenType,
    } from '../../../data/enumerations';

    import {
        ScanMode,
    } from '../../../data/interfaces';

    import Token from '../../Token';

    import {
        inGroupClassify,
    } from '../../../utilities/general';
    // #endregion external
// #endregion imports



// #region module
class Identifier {
    private tokens: Token[];

    constructor(
        tokens: Token[],
    ) {
        this.tokens = [
            ...tokens,
        ];
    }

    public identify() {
        const tokens: Token[] = [];
        let mode: ScanMode = '';
        let mapLookup = false;
        let mapItemLine = -1;
        let listItemLine = -1;
        let temporary: Token[] = [];
        let leaflinkIdentify = false;

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

            if (leaflinkIdentify) {
                if (token.type === TokenType.STRING) {
                    tokens.push(token);
                    leaflinkIdentify = false;
                    continue;
                }

                const identifierToken = tokens[tokens.length - 1];

                if (
                    token.type === TokenType.SIGNIFIER
                    && token.line === identifierToken.line
                ) {
                    temporary.push(token);
                    continue;
                }

                stringifyTemporary();
                leaflinkIdentify = false;
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
                const inGroup = this.inGroup(index + 1);

                if (inGroup === 'LEAFLINK') {
                    const identifierToken = this.identifierFromSignifier(token);
                    tokens.push(identifierToken);
                    continue;
                }

                if (inGroup === 'MAP') {
                    temporary.push(token);
                    continue;
                }

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
                const previous = this.tokens[index - 1];

                if (previous && previous.type === TokenType.FROM) {
                    tokens.push(token);

                    continue;
                }

                const identifierToken = this.identifierFromSignifier(token);
                tokens.push(identifierToken);
                leaflinkIdentify = true;
                continue;
            }

            identifySignifier(
                index,
                token,
            );
        }

        return [
            ...tokens,
        ];
    }



    // Utilities
    private stringFromSignifiers(
        tokens: Token[],
    ) {
        let lexemes: string[] = [];
        let literals: string[] = [];
        const line = tokens[0].line;

        for (const token of tokens) {
            lexemes.push(token.lexeme);

            // Handle string quotes in middle of value.
            if (
                token.type === TokenType.STRING
                && tokens.length > 1
            ) {
                literals.push(token.lexeme);
                continue;
            }

            if (token.literal) {
                literals.push(token.literal);
            } else {
                literals.push(token.lexeme);
            }
        }

        const lexeme = lexemes.join(' ');
        const literal = literals.join(' ');

        const stringToken = new Token(
            TokenType.STRING,
            lexeme,
            literal,
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

        return inGroupClassify(
            tokens,
        );
    }
}
// #endregion module



// #region exports
export default Identifier;
// #endregion exports
