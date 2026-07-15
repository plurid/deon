//! The Deon command-line tool.
//!
//! The surface is the reference implementation's, command for command and default for default
//! (`packages/deon-javascript/source/utilities/cli/index.ts`). Two tools that disagree about what
//! `--network` defaults to would be two tools.

use std::path::{Component, Path, PathBuf};
use std::process::{Command, ExitCode};

use deon::json::{parse_json, write_json, write_typed_json};
use deon::value::Value;
use deon::{DeonError, ParseOptions, StringifyOptions};

const HELP: &str = "\
Usage: deon <file> [options]
       deon convert <source.json> [destination.deon]
       deon environment <source.deon> <command...>
       deon confile <files...> [--destination confile.deon]
       deon exfile <source.deon> [--unsafe-paths]
       deon lint <files...> [--warnings-as-errors]

Options:
  -o, --output <deon|json>
  -t, --typed
  -f, --filesystem <true|false>
  -n, --network <true|false>
  -d, --destination <path>
  -w, --writeover
      --unsafe-paths
      --warnings-as-errors
  -v, --version
  -h, --help
";

/// The options that take the next argument as their value.
const VALUED: [&str; 8] = [
    "-d",
    "--destination",
    "-o",
    "--output",
    "-f",
    "--filesystem",
    "-n",
    "--network",
];

/// Anything that went wrong. A `DeonError` is reported with its position; everything else is a
/// sentence.
enum Failure {
    Deon(DeonError),
    Message(String),
}

impl From<DeonError> for Failure {
    fn from(error: DeonError) -> Self {
        Failure::Deon(error)
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, Failure> {
    Err(Failure::Message(message.into()))
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();

    match run(&arguments) {
        Ok(code) => code,

        Err(Failure::Deon(error)) => {
            // The same line an editor would underline: where it is, how bad, what it is called.
            for diagnostic in &error.diagnostics {
                eprintln!(
                    "{}:{}:{} {} {} {}",
                    diagnostic.span.source,
                    diagnostic.span.line,
                    diagnostic.span.column,
                    severity(diagnostic.severity),
                    diagnostic.code,
                    diagnostic.message,
                );
            }

            ExitCode::FAILURE
        }

        Err(Failure::Message(message)) => {
            eprintln!("deon: {message}");

            ExitCode::FAILURE
        }
    }
}

fn severity(severity: deon::Severity) -> &'static str {
    match severity {
        deon::Severity::Error => "error",
        deon::Severity::Warning => "warning",
    }
}

fn run(arguments: &[String]) -> Result<ExitCode, Failure> {
    if arguments.iter().any(|a| a == "-v" || a == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));

        return Ok(ExitCode::SUCCESS);
    }

    if arguments.is_empty() || arguments.iter().any(|a| a == "-h" || a == "--help") {
        print!("{HELP}");

        return Ok(ExitCode::SUCCESS);
    }

    match arguments[0].as_str() {
        "convert" => convert(arguments),
        "environment" => environment(arguments),
        "confile" => confile(arguments),
        "exfile" => exfile(arguments),
        "lint" => lint(arguments),
        _ => parse(arguments),
    }
}

/// The options with the host process environment folded in, so that a `#$NAME` in a document the
/// *user* asked to evaluate reads the host environment, as the reference CLI does. The library never
/// consults the host environment itself (specification 6): a document is data, and data must not be
/// able to read a host secret. The CLI is a host tool, so it supplies the host environment explicitly
/// — which is the one place it is allowed to come from — rather than the core reaching for it.
fn with_host_environment(mut options: ParseOptions) -> ParseOptions {
    options.environment.extend(std::env::vars());
    options
}

/// `deon <file>` — read a document and write it back out.
fn parse(arguments: &[String]) -> Result<ExitCode, Failure> {
    let file = &arguments[0];
    let path = resolve(file);

    // The file named on the command line is read either way — naming it is asking for it. What
    // `--filesystem` decides is whether *its imports* may reach the disk, which is why this reads the
    // file itself rather than going through `parse_file`, whose whole job is to grant that.
    let source = deon::read_file(&path)?;

    let options = with_host_environment(
        ParseOptions::new()
            .source_name(&path)
            .filebase(deon::resources::directory_of(&path))
            .allow_filesystem(option(arguments, "-f", "--filesystem", "true") == "true")
            .allow_network(option(arguments, "-n", "--network", "false") == "true"),
    );

    let value = deon::parse_with(&source, &options)?;

    match option(arguments, "-o", "--output", "deon").as_str() {
        "deon" => {
            print!("{}", deon::stringify(&value, &StringifyOptions::default())?);
        }
        "json" => {
            if toggle(arguments, "-t", "--typed") {
                print!("{}", write_typed_json(&deon::typed(&value)?));
            } else {
                print!("{}", write_json(&value));
            }
        }
        other => return fail(format!("Unsupported output '{other}'.")),
    }

    Ok(ExitCode::SUCCESS)
}

/// `deon convert <source.json> [destination.deon]`
fn convert(arguments: &[String]) -> Result<ExitCode, Failure> {
    let positionals = positional(&arguments[1..]);

    let Some(source) = positionals.first() else {
        return fail("convert requires a source file.");
    };

    let data = read(source)?;

    // The crate's own JSON reader, which is the point: a number keeps the spelling it was written
    // with (specification 9.1), so `1.50` converts to `1.50` and not to `1.5`.
    let value = match parse_json(&data) {
        Ok(value) => value,
        Err(error) => return fail(format!("Invalid JSON in '{source}': {error}")),
    };

    let written = deon::stringify(&value, &StringifyOptions::default())?;

    match positionals.get(1) {
        Some(destination) => write(destination, &written)?,
        None => print!("{written}"),
    }

    Ok(ExitCode::SUCCESS)
}

/// `deon environment <source.deon> <command...>` — run a command with the document as its environment.
fn environment(arguments: &[String]) -> Result<ExitCode, Failure> {
    let overwrite = arguments.iter().any(|a| a == "-w" || a == "--writeover");

    let command: Vec<&String> = arguments
        .iter()
        .skip(2)
        .filter(|a| *a != "-w" && *a != "--writeover")
        .collect();

    if arguments.len() < 2 || command.is_empty() {
        return fail("environment requires a source file and a command.");
    }

    let value = deon::parse_file(
        &arguments[1],
        &with_host_environment(ParseOptions::new().allow_filesystem(true)),
    )?;

    let Value::Map(entries) = &value else {
        return fail("An environment source must contain a root map.");
    };

    let mut process = Command::new(command[0]);
    process.args(&command[1..]);

    for (name, entry) in entries.iter() {
        // The root must be strings, or lists of strings; anything else is not an environment
        // variable and is passed over rather than mangled into one.
        let text = match entry {
            Value::String(text) => text.clone(),
            Value::List(items) => items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
                .join(","),
            Value::Map(_) => continue,
        };

        // Without `--writeover`, what is already in the environment stands.
        if overwrite || std::env::var_os(name).is_none() {
            process.env(name, text);
        }
    }

    match process.status() {
        Ok(status) => Ok(match status.code() {
            Some(0) => ExitCode::SUCCESS,
            _ => ExitCode::FAILURE,
        }),
        Err(error) => fail(format!("Unable to run '{}': {error}.", command[0])),
    }
}

/// `deon confile <files...>` — consolidate files into one document.
fn confile(arguments: &[String]) -> Result<ExitCode, Failure> {
    let destination = option(arguments, "-d", "--destination", "confile.deon");

    let files: Vec<String> = positional(&arguments[1..])
        .into_iter()
        .filter(|file| *file != destination)
        .collect();

    if files.is_empty() {
        return fail("confile requires at least one input file.");
    }

    let mut root = deon::Map::new();

    for file in &files {
        let mut entry = deon::Map::new();
        entry.insert("data", Value::string(read(file)?));

        // Keyed by the path as it was typed, so that `exfile` puts it back where it came from.
        root.insert(file.clone(), Value::Map(entry));
    }

    let written = deon::stringify(&Value::Map(root), &StringifyOptions::default())?;
    write(&destination, &written)?;

    Ok(ExitCode::SUCCESS)
}

/// `deon exfile <source.deon>` — the inverse of `confile`.
///
/// This is the one command that writes what a document tells it to, so it is the one that has to be
/// suspicious. A `.deon` file is *data*, and data that arrived from anywhere must not be able to
/// write outside the directory it is unpacked in.
fn exfile(arguments: &[String]) -> Result<ExitCode, Failure> {
    let Some(source) = arguments.get(1) else {
        return fail("exfile requires a source file.");
    };

    let unsafe_paths = arguments.iter().any(|a| a == "--unsafe-paths");

    let value = deon::parse_file(
        source,
        &with_host_environment(ParseOptions::new().allow_filesystem(true)),
    )?;

    let Value::Map(entries) = &value else {
        return fail("An exfile source must contain a root map.");
    };

    let mut files: Vec<(PathBuf, String)> = Vec::new();

    // Every entry is checked before any is written, so a bad one writes nothing at all rather than
    // leaving half an archive on the disk.
    for (path, entry) in entries.iter() {
        let data = match entry {
            Value::String(data) => data.clone(),
            Value::Map(map) => match map.get("data").and_then(Value::as_str) {
                Some(data) => data.to_string(),
                None => {
                    return fail(format!(
                        "Exfile entry '{path}' must be a string or a map with a string data field."
                    ))
                }
            },
            Value::List(_) => {
                return fail(format!(
                    "Exfile entry '{path}' must be a string or a map with a string data field."
                ))
            }
        };

        let candidate = Path::new(path);

        if !unsafe_paths && escapes(candidate) {
            return fail(format!(
                "Unsafe exfile path '{path}'. Use --unsafe-paths to permit it."
            ));
        }

        let destination = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(candidate)
        };

        files.push((destination, data));
    }

    for (destination, data) in files {
        if let Some(directory) = destination.parent() {
            if let Err(error) = std::fs::create_dir_all(directory) {
                return fail(format!("Unable to create '{}': {error}.", directory.display()));
            }
        }

        if let Err(error) = std::fs::write(&destination, data) {
            return fail(format!("Unable to write '{}': {error}.", destination.display()));
        }
    }

    Ok(ExitCode::SUCCESS)
}

/// Whether a path would put a file somewhere other than under the directory it is unpacked in.
fn escapes(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }

    let mut depth: i32 = 0;

    for component in path.components() {
        match component {
            Component::ParentDir => {
                depth -= 1;

                if depth < 0 {
                    return true;
                }
            }
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}

            // A root or a drive prefix is not relative at all.
            Component::RootDir | Component::Prefix(_) => return true,
        }
    }

    false
}

/// `deon lint <files...>`
fn lint(arguments: &[String]) -> Result<ExitCode, Failure> {
    let files = positional(&arguments[1..]);

    if files.is_empty() {
        return fail("lint requires at least one input file.");
    }

    let strict = arguments.iter().any(|a| a == "--warnings-as-errors");
    let mut warnings = 0usize;

    for file in &files {
        // A diagnostic names the document by its resolved path, as the reference does, so that a
        // tool reading this output gets the same string from either implementation.
        let path = resolve(file);

        // `read_file` and not `read`: a document named on the command line that cannot be read is a
        // `DEON_RESOURCE_IO` diagnostic, carrying a code and a position, rather than a sentence.
        let source = deon::read_file(&path)?;

        for diagnostic in deon::lint(&source, &path)? {
            println!(
                "{}:{}:{} {} {} {}",
                path,
                diagnostic.span.line,
                diagnostic.span.column,
                severity(diagnostic.severity),
                diagnostic.code,
                diagnostic.message,
            );

            warnings += 1;
        }

        // Linting reports the warnings; evaluating is what surfaces the errors. A document that does
        // not evaluate has more wrong with it than a linter is allowed to say.
        let options = with_host_environment(
            ParseOptions::new()
                .allow_filesystem(true)
                .source_name(&path)
                .filebase(deon::resources::directory_of(&path)),
        );

        deon::parse_with(&source, &options)?;
    }

    Ok(if warnings > 0 && strict {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// A path as the reference resolves it: joined onto the working directory, with symbolic links left
/// exactly as they are.
fn resolve(file: &str) -> String {
    let path = Path::new(file);

    if path.is_absolute() {
        return file.to_string();
    }

    std::env::current_dir()
        .map(|cwd| cwd.join(path).to_string_lossy().into_owned())
        .unwrap_or_else(|_| file.to_string())
}

fn read(file: &str) -> Result<String, Failure> {
    match std::fs::read_to_string(file) {
        Ok(data) => Ok(data),
        Err(error) => fail(format!("Unable to read '{file}': {error}.")),
    }
}

fn write(file: &str, data: &str) -> Result<(), Failure> {
    if let Some(directory) = Path::new(file).parent() {
        if !directory.as_os_str().is_empty() {
            if let Err(error) = std::fs::create_dir_all(directory) {
                return fail(format!("Unable to create '{}': {error}.", directory.display()));
            }
        }
    }

    match std::fs::write(file, data) {
        Ok(()) => Ok(()),
        Err(error) => fail(format!("Unable to write '{file}': {error}.")),
    }
}

/// The value of an option, or the fallback. There is no `--flag=value` form, as in the reference.
fn option(arguments: &[String], short: &str, long: &str, fallback: &str) -> String {
    arguments
        .iter()
        .position(|a| a == short || a == long)
        .and_then(|at| arguments.get(at + 1))
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

/// A bare flag, or the `--flag false` form.
fn toggle(arguments: &[String], short: &str, long: &str) -> bool {
    let Some(at) = arguments.iter().position(|a| a == short || a == long) else {
        return false;
    };

    arguments.get(at + 1).map(String::as_str) != Some("false")
}

/// The arguments that are not options, nor the values of options.
fn positional(arguments: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut index = 0;

    while index < arguments.len() {
        let argument = &arguments[index];

        if VALUED.contains(&argument.as_str()) {
            // The value of a valued option is not a positional.
            index += 2;
            continue;
        }

        if argument == "-t" || argument == "--typed" {
            // `--typed` takes a value only when one was actually written; otherwise it is bare and
            // whatever follows is a positional in its own right.
            let explicit = arguments
                .get(index + 1)
                .map(String::as_str)
                .is_some_and(|next| next == "true" || next == "false");

            index += if explicit { 2 } else { 1 };
            continue;
        }

        if argument.starts_with('-') {
            index += 1;
            continue;
        }

        out.push(argument.clone());
        index += 1;
    }

    out
}
