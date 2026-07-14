//! A document is data, and data can come from somewhere that does not wish the reader well.
//!
//! The parser recurses on how deeply a document nests, so without a limit a hostile document takes
//! the process down with it — and a host that dies on its input is not a library. What must come back
//! is a diagnostic, with a code and a position, because that is something a caller can act on.
//!
//! The limit has to hold on the *smallest* stack a caller is likely to have, not on the generous one
//! the main thread happens to get. These tests run the parse on a 2 MiB stack — what a spawned thread
//! is given by default — which is the thing an ordinary `cargo run` check quietly fails to exercise.

/// What a parse said, in a shape that can cross a thread boundary — a `DeonError` cannot, because its
/// span holds an `Rc<str>`. `Ok(None)` is a document that parsed.
type Outcome = Option<(String, String, usize, usize)>;

/// A 2 MiB stack, and a parse on it. `Err` if the thread died, which is what a stack overflow does.
fn parse_on_a_small_stack(source: String) -> Result<Outcome, ()> {
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || match deon::parse(&source) {
            Ok(_) => None,
            Err(error) => {
                let span = &error.diagnostics[0].span;

                Some((
                    error.code.to_string(),
                    error.message.clone(),
                    span.line,
                    span.column,
                ))
            }
        })
        .expect("the thread should spawn")
        .join()
        .map_err(|_| ())
}

fn nested(depth: usize) -> String {
    format!("{{ a {}{} }}", "[".repeat(depth), "]".repeat(depth))
}

#[test]
fn a_document_that_nests_too_deeply_is_refused_rather_than_fatal() {
    let outcome = parse_on_a_small_stack(nested(5_000))
        .expect("the parser must refuse a deep document, not overflow the stack");

    let (code, message, _, _) = outcome.expect("a document past the limit must not parse");

    assert_eq!(code, "DEON_PARSE_EXPECTED");
    assert!(message.contains("nests more deeply"), "unexpected message: {message}");
}

/// The refusal carries a position, which is the whole difference between a diagnostic and a crash.
/// The source opens with `{ a ` — four characters — and the guard trips on the value that would sit
/// one past the limit, so it points at the 129th `[`.
#[test]
fn the_refusal_says_where() {
    let outcome = parse_on_a_small_stack(nested(200))
        .expect("the parser must refuse a deep document, not overflow the stack");

    let (_, _, line, column) = outcome.expect("a document past the limit must not parse");

    assert_eq!((line, column), (1, 4 + 128 + 1));
}

/// And the limit is far past anything a person would write, so an ordinarily deep document is read.
#[test]
fn a_document_that_merely_nests_is_read() {
    let outcome = parse_on_a_small_stack(nested(64))
        .expect("an ordinary document must not overflow the stack");

    assert!(outcome.is_none(), "a document within the limit must parse: {outcome:?}");
}
