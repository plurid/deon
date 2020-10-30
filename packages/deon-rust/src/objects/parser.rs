use super::super::data::enums::{TokenType};
use super::token::{Token};



pub struct Parser {
    tokens: Vec<Token>,
    current: usize,
}


impl Parser {
    pub fn new() -> Parser {
        Parser {
            tokens: vec![],
            current: 0,
        }
    }

    pub fn parse(
        &mut self,
    ) -> Vec<bool> {
        let mut statements = vec![];

        while !self.is_at_end() {
            let declaration = self.declaration();

            statements.push(declaration);
        }

        statements
    }

    fn declaration(
        &mut self,
    ) -> bool {
        let current = self.peek();

        match current.token_type {
            TokenType::Import => (),
            TokenType::Inject => (),
            TokenType::String => (),
            TokenType::Identifier => (),
            TokenType::Link => (),
            TokenType::LeftCurlyBracket => (),
            TokenType::LeftSquareBracket => (),
            _ => (),
        }

        self.advance();

        true
    }


    // utilities
    fn advance(
        &mut self,
    ) -> Token {
        if !self.is_at_end() {
            self.current += 1;
        }

        self.previous()
    }

    fn peek(
        &mut self
    ) -> Token {
        self.tokens[self.current].clone()
    }

    fn previous(
        &mut self
    ) -> Token {
        self.tokens[self.current - 1].clone()
    }

    fn is_at_end(
        &mut self,
    ) -> bool {
        self.peek().token_type == TokenType::Eof
    }
}
