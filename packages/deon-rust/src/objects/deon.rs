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

        self.parse(content.lines());
    }

    pub fn parse(
        self: &Self,
        data: std::str::Lines,
    ) {
        for line in data {
            println!("{}", line);
        }
    }
}
