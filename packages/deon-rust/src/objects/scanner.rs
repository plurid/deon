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
        &self,
    ) -> Vec<Token> {
        self.scan_tokens();

        self.tokens
    }

    fn scan_tokens(
        &self,
    ) {
        for line in self.data.lines() {
            println!("{}", line);
        }

        self.end_scan();
    }

    fn end_scan(
        &self,
    ) {
        let end_of_file = Token {
            token_type: TokenType::Eof,
            lexeme: String::from(""),
            literal: String::from(""),
            line: 0,
        };

        self.tokens.push(end_of_file);
    }
}
