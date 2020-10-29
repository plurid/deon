use structopt::StructOpt;

use deon::Deon;



/// Parse a .deon file.
#[derive(StructOpt)]
struct Cli {
    /// The .deon filepath
    #[structopt(parse(from_os_str))]
    path: std::path::PathBuf,
}


fn main() {
    let args = Cli::from_args();

    let deon = Deon {};
    deon.demand(&args.path);
}
