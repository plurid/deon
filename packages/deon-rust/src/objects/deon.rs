use std::collections::HashMap;

use super::scanner::{Scanner};



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
        let scanner = Scanner::new(data);
        let tokens = scanner.scan();

        let result: HashMap<&str, String> = HashMap::new();

        return result;
    }
}
