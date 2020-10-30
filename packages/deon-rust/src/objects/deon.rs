use std::collections::HashMap;

use super::scanner::{Scanner};
use super::parser::{Parser};



pub struct Deon {
}


impl Deon {
    pub fn demand(
        self: &Self,
        path: &std::path::PathBuf,
    ) {
        println!("Deon :: parsing filepath {}", path.to_str().unwrap());

        let content = std::fs::read_to_string(path)
            .expect("Deon :: could not read file");

        self.parse(content);
    }

    pub fn parse(
        self: &Self,
        data: String,
    ) -> HashMap<&str, String> {
        let mut scanner = Scanner::new(data);
        let mut tokens = scanner.scan();
        // Debug.
        for token in tokens.clone() {
            println!("{}", token.to_string());
        }

        let mut parser = Parser::new(tokens);
        let statements = parser.parse();
        // // Debug.
        // for statement in statements.clone() {
        //     println!("{}", statement.to_string());
        // }

        // let interpretOptions = HashMap::new();
        // let mut interpreter = Interpreter::new();
        // let data = interpreter.interpret(
        //     statements,
        // );

        let result: HashMap<&str, String> = HashMap::new();
        return result;
    }
}
