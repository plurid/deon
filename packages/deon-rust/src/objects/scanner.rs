use std::collections::HashMap;

use super::super::data::enums::{TokenType};
use super::token::{Token};



pub struct Scanner {
    pub data: String,
    tokens: Vec<Token>,
    start: i64,
    current: i64,
    line: i32,
    keywords: HashMap<String, TokenType>,
}


impl Scanner {
    pub fn new(
        data: String,
    ) -> Scanner {
        let mut keywords: HashMap<String, TokenType> = HashMap::new();

        keywords.insert(String::from("import"), TokenType::Import);
        keywords.insert(String::from("inject"), TokenType::Inject);
        keywords.insert(String::from("from"), TokenType::From);
        keywords.insert(String::from("with"), TokenType::With);

        Scanner {
            data: data,
            tokens: vec![],
            start: 0,
            current: 0,
            line: 0,
            keywords,
        }
    }

    pub fn scan(
        &mut self,
    ) -> Vec<Token> {
        self.scan_tokens();

        let mut tokens = self.tokens.to_vec();

        tokens
    }

    fn scan_tokens(
        &mut self,
    ) {
        while !self.is_at_end() {
            self.scan_token();
        }

        self.end_scan();

        self.identify();
    }

    fn scan_token(
        &mut self,
    ) {
        let character = self.advance();

        match character {
            '[' => self.add_token(TokenType::LeftSquareBracket),
            ']' => self.add_token(TokenType::RightSquareBracket),

            '{' => self.add_token(TokenType::LeftCurlyBracket),
            '}' => self.add_token(TokenType::RightCurlyBracket),

            ',' => self.add_token(TokenType::Comma),
            '#' => self.link(),
            '.' => self.dot(),
            '/' => self.slash(),
            '*' => self.star(),

            // Ignore whitespace.
            ' ' | '\r' | '\t' => (),

            '\'' => self.singleline_string(),
            '`' => self.multiline_string(),

            '\n' => self.line += 1,

            _ => self.signifier(),
        }
    }

    fn end_scan(
        &mut self,
    ) {
        let end_of_file = Token {
            token_type: TokenType::Eof,
            lexeme: String::from(""),
            literal: String::from(""),
            line: 0,
        };

        self.tokens.push(end_of_file);
    }

    fn add_token(
        &mut self,
        token_type: TokenType,
    ) {
        self.add_token_literal(
            token_type,
            String::from(""),
        );
    }

    fn add_token_literal(
        &mut self,
        token_type: TokenType,
        literal: String,
    ) {
        let lexeme: String = self.data
            .chars()
            .skip(self.start as usize)
            .take(self.current as usize)
            .collect();

        let new_token = Token {
            token_type,
            lexeme,
            literal,
            line: self.line,
        };

        self.tokens.push(new_token);
    }


    // matches
    fn link(
        &mut self,
    ) {
        if self.match_character('\'') {
            while self.peek() != '\'' && self.is_at_end() {
                if self.peek() == '\n' {
                    self.line += 1;

                    // Error: Unterminated link string.
                    return;
                }
            }

            if self.is_at_end() {
                // Error: Unterminated link string.
                return;
            }

            // The closing '.
            self.advance();

            // Extract the value without the initial hashstring (#')
            // and without the last string mark.
            let value = String::from(
                &self.data.to_string()[
                    (self.start + 2) as usize..(self.current - 1) as usize
                ]
            );

            self.add_token_literal(
                TokenType::Link,
                value,
            );
            return;
        }

        while
            self.peek() != ' '
            && self.peek() != '\n'
            && !self.is_at_end()
        {
            self.advance();
        }

        if self.is_at_end() {
            // Error: Unterminated link.
            return;
        }

        // Extract the value without the initial hash (#).
        let value = String::from(
            &self.data.to_string()[
                (self.start + 1) as usize..(self.current) as usize
            ]
        );

        self.add_token_literal(
            TokenType::Link,
            value,
        );
        return;
    }

    fn dot(
        &mut self,
    ) {
        if self.match_character('.') {
            if self.match_character('.') {
                if self.match_character('#') {
                    self.spread();
                } else {
                    // Error: Can only spread leaflinks.
                    return;
                }
            } else {
                self.signifier();
            }
        } else {
            self.signifier();
        }
    }

    fn slash(
        &mut self,
    ) {
        if self.match_character('/') {
            // A comment goes until the end of the line.
            while self.peek() != '\n' && !self.is_at_end() {
                self.advance();
            }
        } else if self.match_character('*') {
            // A multline comment goes until starslash (*/).
            while self.peek() != '*' && !self.is_at_end() {
                self.advance();
            }
        } else {
            self.signifier();
        }
    }

    fn star(
        &mut self,
    ) {
        if self.match_character('/') {
            self.advance();
        }
    }

    fn singleline_string(
        &mut self,
    ) {
        while
            (self.peek() != '\'' || self.peek() == '\\')
            && !self.is_at_end()
        {
            if self.peek() == '\n' {
                self.line += 1;

                // Error: Unterminated string.
                return;
            }

            if self.peek() == '\\' {
                self.advance_escaped();
            } else {
                self.advance();
            }
        }

        if self.is_at_end() {
            // Error: Unterminated string.
            return;
        }

        // The closing '.
        self.advance();

        let value = String::from(
            &self.data.to_string()[
                (self.start + 1) as usize..(self.current - 1) as usize
            ]
        );

        self.add_token_literal(
            TokenType::String,
            value,
        );
    }

    fn multiline_string(
        &mut self,
    ) {
        while
            (self.peek() != '`' || self.peek() == '\\')
            && !self.is_at_end()
        {
            if self.peek() == '\n' {
                self.line += 1;
                self.advance();

                continue;
            }

            if self.peek() == '\\' {
                self.advance_escaped();
            } else {
                self.advance();
            }
        }

        if self.is_at_end() {
            // Error: Unterminated string.
            return;
        }

        // The closing '.
        self.advance();

        let value = String::from(
            self.data.to_string()[
                (self.start + 1) as usize..(self.current - 1) as usize
            ].trim()
        );

        self.add_token_literal(
            TokenType::String,
            value,
        );
    }

    fn signifier(
        &mut self,
    ) {
        let mut character = self.peek();
        while self.is_alpha_numeric(character) {
            character = self.advance();
        }

        let value = String::from(
            &self.data.to_string()[
                (self.start) as usize..(self.current) as usize
            ]
        );

        let mut token_type_option = self.keywords.get(&value);
        let mut token_type = token_type_option.unwrap_or(&TokenType::Signifier);
        let mut token_type_clone = token_type.clone();

        let length = self.tokens.len() - 1;
        let in_group = in_group(
            self.tokens.clone(),
            length,
        );

        match token_type {
            TokenType::Import | TokenType::Inject | TokenType::From | TokenType::With => {
                if in_group != "LEAFLINK" {
                    token_type_clone = TokenType::Signifier;
                }
            },
            _ => (),
        }

        self.add_token(token_type_clone);
    }

    fn spread(
        &mut self,
    ) {
        if self.match_character('\'') {
            // Handle link string spread.
            while self.peek() != '\'' && self.is_at_end() {
                if self.peek() == '\n' {
                    self.line += 1;

                    // Error: Unterminated link string spread.
                    return;
                }

                self.advance();
            }

            // Unterminated link string spread.
            if self.is_at_end() {
                return;
            }

            // The closing '.
            self.advance();

            // Extract the value without the initial dot hashstring (...#')
            // and without the last string mark.
            let value = String::from(
                &self.data.to_string()[
                    (self.start + 5) as usize..(self.current - 1) as usize
                ]
            );

            self.add_token_literal(
                TokenType::Spread,
                value,
            );
            return;
        }

        let mut character = self.peek();
        while self.is_alpha_numeric(character) {
            character = self.advance();
        }

        let value = String::from(
            &self.data.to_string()[
                (self.start) as usize..(self.current) as usize
            ]
        );

        self.add_token_literal(
            TokenType::Spread,
            value,
        );
        return;
    }

    fn identify(
        &self,
    ) {

    }


    // utilities
    fn advance(
        &mut self,
    ) -> char {
        self.current += 1;

        self.data.chars().nth((self.current - 1) as usize).unwrap()
    }

    fn advance_escaped(
        &mut self,
    ) -> char {
        self.current += 2;

        self.data.chars().nth((self.current - 1) as usize).unwrap()
    }

    fn match_character(
        &mut self,
        expected: char,
    ) -> bool {
        if self.is_at_end() {
            return false;
        }

        if self.data.chars().nth((self.current) as usize).unwrap() != expected {
            return false;
        }

        self.current += 1;
        true
    }

    fn is_at_end(
        &mut self,
    ) -> bool {
        self.current as usize >= self.data.chars().count()
    }

    fn peek(
        &mut self,
    ) -> char {
        if self.is_at_end() {
            return '\0';
        }

        self.data.chars().nth((self.current) as usize).unwrap()
    }

    fn is_alpha(
        &mut self,
        character: char,
    ) -> bool {
        character.is_alphabetic()
    }

    fn is_digit(
        &mut self,
        character: char,
    ) -> bool {
        character.is_digit(10)
    }

    fn is_alpha_numeric(
        &mut self,
        character: char,
    ) -> bool {
        self.is_alpha(character) || self.is_digit(character)
    }

    fn string_from_signifiers(
        &self,
        tokens: Vec<Token>,
    ) -> Token {
        let line = tokens[0].line;

        let mut texts = vec![];

        for token in tokens {
            texts.push(token.lexeme);
        }

        let lexeme = texts.join(" ");
        let literal = lexeme.clone();

        Token {
            token_type: TokenType::String,
            lexeme,
            literal,
            line,
        }
    }

    fn identifier_from_signifier(
        &self,
        token: Token,
    ) -> Token{
        let lexeme = token.lexeme.replace('\'', "");
        let literal = String::from("");
        let line = token.line;

        Token {
            token_type: TokenType::Identifier,
            lexeme,
            literal,
            line,
        }
    }
}


fn in_group(
    tokens_source: Vec<Token>,
    position: usize,
) -> String {
    let mut tokens = tokens_source.clone();
    tokens.truncate(position);
    tokens.reverse();

    if tokens.len() == 0 {
        return String::from("LEAFLINK");
    }

    let mut curly_brackets: HashMap<String, i32> = HashMap::new();
    curly_brackets.insert(String::from("left"), 0);
    curly_brackets.insert(String::from("right"), 0);

    let mut square_brackets: HashMap<String, i32> = HashMap::new();
    square_brackets.insert(String::from("left"), 0);
    square_brackets.insert(String::from("right"), 0);

    for token in tokens {
        match token.token_type {
            TokenType::LeftCurlyBracket => *curly_brackets.get_mut("left").unwrap() += 1,
            TokenType::RightCurlyBracket => *curly_brackets.get_mut("right").unwrap() += 1,
            TokenType::LeftSquareBracket => *square_brackets.get_mut("left").unwrap() += 1,
            TokenType::RightSquareBracket => *square_brackets.get_mut("right").unwrap() += 1,
            _ => (),
        }

        let curly_brackets_left = curly_brackets.get("left").unwrap_or(&0);
        let curly_brackets_right = curly_brackets.get("right").unwrap_or(&0);

        if curly_brackets_left > curly_brackets_right {
            return String::from("MAP");
        }

        let square_brackets_left = square_brackets.get("left").unwrap_or(&0);
        let square_brackets_right = square_brackets.get("right").unwrap_or(&0);

        if square_brackets_left > square_brackets_right {
            return String::from("LIST");
        }
    }

    let curly_brackets_left = curly_brackets.get("left").unwrap_or(&0);
    let curly_brackets_right = curly_brackets.get("right").unwrap_or(&0);

    let square_brackets_left = square_brackets.get("left").unwrap_or(&0);
    let square_brackets_right = square_brackets.get("right").unwrap_or(&0);

    if
        curly_brackets_left == curly_brackets_right
        && square_brackets_left == square_brackets_right
    {
        return String::from("LEAFLINK");
    }

    return String::from("");
}
