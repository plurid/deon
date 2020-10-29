use super::super::data::enums::{TokenType};



pub struct Token {
    pub token_type: TokenType,
    pub lexeme: String,
    pub literal: String,
    pub line: i32,
}


impl Token {
    pub fn to_string(
        &self,
    ) -> String {
        return String::from(
            self.token_type.to_string() + " " + &self.lexeme + " " + &self.literal
        );
    }
}
