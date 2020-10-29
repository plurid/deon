use std::collections::HashMap;

use super::super::data::enums::{TokenType};
use super::token::{Token};



pub struct Scanner {
    pub data: String,
    tokens: Vec<Token>,
    start: i64,
    current: i64,
    line: i32,
}


impl Scanner {
    pub fn new(
        data: String,
    ) -> Scanner {
        Scanner {
            data: data,
            tokens: vec![],
            start: 0,
            current: 0,
            line: 0,
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
            '#' => self.add_token(TokenType::Link),
            '.' => self.add_token(TokenType::Dot),

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


    // matchs
    fn slash(
        &mut self,
    ) {}

    fn star(
        &mut self,
    ) {}

    fn singleline_string(
        &mut self,
    ) {}

    fn multiline_string(
        &mut self,
    ) {}

    fn signifier(
        &mut self,
    ) {}


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
}
