use std::collections::HashMap;

use super::super::data::enums::{TokenType};



pub struct Scanner {
    pub data: String,
}


impl Scanner {
    pub fn scan(
        &self,
    ) -> String {
        let mut tokens: Vec<TokenType> = Vec::new();
        let mut start = 0;
        let mut current = 0;
        let mut line = 0;


        for line in self.data.lines() {
            println!("{}", line);
        }

        return self.data.clone();
    }
}
