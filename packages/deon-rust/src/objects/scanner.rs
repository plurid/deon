pub struct Scanner {
    pub data: String,
}


impl Scanner {
    pub fn scan(
        &self,
    ) -> String {
        for line in self.data.lines() {
            println!("{}", line);
        }

        return self.data.clone();
    }
}
