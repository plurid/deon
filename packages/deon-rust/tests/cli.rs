//! The command-line tool, run as a command-line tool.
//!
//! Cargo hands the built binary's path to an integration test, so these exercise the real thing
//! rather than the functions behind it — which is the point, because the bugs a CLI has are in its
//! argument handling and its exit codes.

#![cfg(feature = "cli")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const DEON: &str = env!("CARGO_BIN_EXE_deon");

/// A directory of its own per test, so nothing here can see anything else here.
fn scratch(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("deon-cli-{name}"));

    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).expect("a scratch directory");

    directory
}

fn write(directory: &Path, file: &str, data: &str) {
    let path = directory.join(file);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("a parent directory");
    }

    std::fs::write(path, data).expect("a file");
}

fn deon(directory: &Path, arguments: &[&str]) -> Output {
    Command::new(DEON)
        .args(arguments)
        .current_dir(directory)
        .output()
        .expect("the binary runs")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

const DOCUMENT: &str = "{\n    name  The Name\n    count 007\n    ok    true\n    pi    1.50\n}\n";

#[test]
fn a_document_is_written_back_as_deon() {
    let directory = scratch("parse");
    write(&directory, "a.deon", DOCUMENT);

    let output = deon(&directory, &["a.deon"]);

    assert!(output.status.success());
    assert_eq!(
        stdout(&output),
        "{\n    name The Name\n    count 007\n    ok true\n    pi 1.50\n}\n",
    );
}

/// Everything is a string until the typer says otherwise, and `--typed` is where it says so.
#[test]
fn json_output_is_typed_only_when_it_is_asked_for() {
    let directory = scratch("json");
    write(&directory, "a.deon", DOCUMENT);

    let untyped = stdout(&deon(&directory, &["a.deon", "-o", "json"]));

    assert!(untyped.contains(r#""ok": "true""#), "{untyped}");
    assert!(untyped.contains(r#""count": "007""#));
    assert!(untyped.contains(r#""pi": "1.50""#));

    let typed = stdout(&deon(&directory, &["a.deon", "-o", "json", "-t"]));

    assert!(typed.contains(r#""ok": true"#), "{typed}");
    assert!(typed.contains(r#""pi": 1.5"#));

    // `007` has a leading zero, so it is not a number it could be written back from.
    assert!(typed.contains(r#""count": "007""#));
}

/// The one that was wrong in the reference until this pass: a JSON number keeps the spelling it was
/// written with (specification 9.1), so converting a file and importing the same file agree.
#[test]
fn convert_keeps_the_spelling_a_number_was_written_with() {
    let directory = scratch("convert");
    write(&directory, "in.json", r#"{ "a": 1.50, "b": 1e3, "c": 9007199254740993 }"#);

    let converted = stdout(&deon(&directory, &["convert", "in.json"]));

    assert!(converted.contains("a 1.50"), "{converted}");
    assert!(converted.contains("b 1e3"), "{converted}");
    assert!(converted.contains("c 9007199254740993"), "{converted}");
}

#[test]
fn the_network_is_off_by_default_and_the_filesystem_is_on() {
    let directory = scratch("capabilities");

    write(&directory, "main.deon", "import other from ./other\n\n{\n    #other.name\n}\n");
    write(&directory, "other.deon", "{\n    name The Name\n}\n");

    // Naming a file on the command line is asking for it to be read.
    let filesystem = deon(&directory, &["main.deon"]);
    assert!(filesystem.status.success(), "{}", stderr(&filesystem));
    assert!(stdout(&filesystem).contains("The Name"));

    // Unless it is not.
    let denied = deon(&directory, &["main.deon", "-f", "false"]);
    assert!(!denied.status.success());
    assert!(stderr(&denied).contains("DEON_CAPABILITY_DENIED"), "{}", stderr(&denied));

    // The network is never on by default. `-n` without a value is not `-n true`.
    write(
        &directory,
        "remote.deon",
        "import other from https://example.invalid/x.deon\n\n{\n    #other.name\n}\n",
    );

    for arguments in [
        vec!["remote.deon"],
        vec!["remote.deon", "-n", "false"],
    ] {
        let output = deon(&directory, &arguments);

        assert!(!output.status.success(), "{arguments:?} should be denied");
        assert!(
            stderr(&output).contains("DEON_CAPABILITY_DENIED"),
            "{arguments:?}: {}",
            stderr(&output),
        );
    }
}

#[test]
fn lint_reports_a_warning_and_an_error_differently() {
    let directory = scratch("lint");
    write(&directory, "dup.deon", "{\n    key one\n    key two\n}\n");

    let output = deon(&directory, &["lint", "dup.deon"]);

    // A warning is advice: it goes to stdout, and it does not fail the command.
    assert!(output.status.success());
    assert!(stdout(&output).contains("DEON_LINT_DUPLICATE_KEY"), "{}", stdout(&output));
    assert!(stdout(&output).contains("warning"));

    // Unless it is asked to.
    let strict = deon(&directory, &["lint", "dup.deon", "--warnings-as-errors"]);
    assert!(!strict.status.success());

    // Linting reports the warnings; evaluating is what surfaces the errors.
    write(&directory, "broken.deon", "{\n    key #nothing\n}\n");

    let broken = deon(&directory, &["lint", "broken.deon"]);

    assert!(!broken.status.success());
    assert!(stderr(&broken).contains("DEON_UNRESOLVED_LINK"), "{}", stderr(&broken));
}

#[test]
fn confile_and_exfile_are_inverses() {
    let directory = scratch("confile");
    write(&directory, "src/one.txt", "hello one\n");
    write(&directory, "src/two.txt", "hello two\n");

    let confiled = deon(&directory, &["confile", "src/one.txt", "src/two.txt", "-d", "archive.deon"]);
    assert!(confiled.status.success(), "{}", stderr(&confiled));

    let unpacked = scratch("exfile");
    std::fs::copy(directory.join("archive.deon"), unpacked.join("archive.deon")).expect("copy");

    let exfiled = deon(&unpacked, &["exfile", "archive.deon"]);
    assert!(exfiled.status.success(), "{}", stderr(&exfiled));

    assert_eq!(
        std::fs::read_to_string(unpacked.join("src/one.txt")).expect("one"),
        "hello one\n",
    );
    assert_eq!(
        std::fs::read_to_string(unpacked.join("src/two.txt")).expect("two"),
        "hello two\n",
    );
}

/// A `.deon` document is *data*, and data must not be able to write wherever it likes. This is the
/// one command that writes what a document tells it to, so it is the one that has to be suspicious.
#[test]
fn exfile_refuses_to_write_outside_the_directory_it_unpacks_in() {
    let directory = scratch("exfile-escape");
    let outside = std::env::temp_dir().join("deon-cli-pwned.txt");

    let _ = std::fs::remove_file(&outside);

    let escaping = format!(
        "{{\n    '../../../../../../{}' owned\n}}\n",
        outside.file_name().unwrap().to_string_lossy(),
    );

    write(&directory, "evil.deon", &escaping);

    let output = deon(&directory, &["exfile", "evil.deon"]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains("Unsafe exfile path"), "{}", stderr(&output));
    assert!(!outside.exists(), "a refused path must not have been written");

    // An absolute path is refused just the same.
    write(
        &directory,
        "absolute.deon",
        &format!("{{\n    '{}' owned\n}}\n", outside.display()),
    );

    let absolute = deon(&directory, &["exfile", "absolute.deon"]);

    assert!(!absolute.status.success());
    assert!(!outside.exists());
}

/// Every entry is checked before any is written, so one bad entry leaves nothing behind rather than
/// half an archive.
#[test]
fn exfile_writes_nothing_at_all_when_one_entry_is_bad() {
    let directory = scratch("exfile-atomic");

    write(
        &directory,
        "mixed.deon",
        "{\n    good.txt fine\n    '../escape.txt' bad\n}\n",
    );

    let output = deon(&directory, &["exfile", "mixed.deon"]);

    assert!(!output.status.success());
    assert!(
        !directory.join("good.txt").exists(),
        "the good entry must not have been written either",
    );
}

#[test]
fn environment_runs_a_command_with_the_document_as_its_environment() {
    let directory = scratch("environment");
    write(&directory, "env.deon", "{\n    DEON_CLI_GREETING hello\n}\n");

    let output = deon(
        &directory,
        &["environment", "env.deon", "sh", "-c", "printf %s \"$DEON_CLI_GREETING\""],
    );

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "hello");
}
