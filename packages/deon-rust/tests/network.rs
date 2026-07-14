//! The network, tested against a server that runs inside the test.
//!
//! Specification 15 forbids a conformance test from touching a public network service, and the rule
//! is a good one well beyond conformance: a suite that reaches the internet fails for reasons that
//! have nothing to do with the code. Everything here binds `127.0.0.1` on a port the kernel picks.

#![cfg(feature = "network")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use deon::{DiagnosticCode, ParseOptions, Value};

/// What a request carried, so a test can ask what was actually sent — including what was *not* sent.
#[derive(Clone, Debug, Default)]
struct Request {
    path: String,
    authorization: Option<String>,
    accept: Option<String>,
}

struct Server {
    base: String,
    requests: Arc<Mutex<Vec<Request>>>,
    hits: Arc<AtomicUsize>,
}

impl Server {
    fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }

    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }
}

/// Serves `routes` (path → (status, body)) until the test is done with it.
fn serve(routes: Vec<(&'static str, u16, String)>, body: impl FnOnce(&Server)) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a local port");
    let port = listener.local_addr().unwrap().port();

    let requests = Arc::new(Mutex::new(Vec::new()));
    let hits = Arc::new(AtomicUsize::new(0));

    let server = Server {
        base: format!("http://127.0.0.1:{port}"),
        requests: Arc::clone(&requests),
        hits: Arc::clone(&hits),
    };

    let worker_requests = Arc::clone(&requests);
    let worker_hits = Arc::clone(&hits);

    let worker = thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };

            // The sentinel connection made when the test is finished; nothing to answer.
            if handle(stream, &routes, &worker_requests, &worker_hits).is_none() {
                break;
            }
        }
    });

    body(&server);

    // Unblock the accept loop so the thread can end.
    let _ = TcpStream::connect(format!("127.0.0.1:{port}"));
    drop(server);
    let _ = worker.join();
}

fn handle(
    mut stream: TcpStream,
    routes: &[(&'static str, u16, String)],
    requests: &Arc<Mutex<Vec<Request>>>,
    hits: &Arc<AtomicUsize>,
) -> Option<()> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);

    let mut start = String::new();
    reader.read_line(&mut start).ok()?;

    // The shutdown connection sends nothing at all.
    if start.trim().is_empty() {
        return None;
    }

    let path = start.split_whitespace().nth(1)?.to_string();
    let mut request = Request {
        path: path.clone(),
        ..Default::default()
    };

    loop {
        let mut line = String::new();

        if reader.read_line(&mut line).ok()? == 0 || line.trim().is_empty() {
            break;
        }

        let Some((name, value)) = line.split_once(':') else {
            continue;
        };

        let value = value.trim().to_string();

        match name.to_ascii_lowercase().as_str() {
            "authorization" => request.authorization = Some(value),
            "accept" => request.accept = Some(value),
            _ => {}
        }
    }

    hits.fetch_add(1, Ordering::SeqCst);
    requests.lock().unwrap().push(request);

    let route = routes.iter().find(|(route, _, _)| *route == path);

    let (status, body) = match route {
        Some((_, status, body)) => (*status, body.clone()),
        None => (404, "not found".to_string()),
    };

    let response = format!(
        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );

    stream.write_all(response.as_bytes()).ok()?;
    stream.flush().ok()?;

    // Drain, so the client is never writing into a closed socket.
    let mut sink = Vec::new();
    let _ = reader.get_mut().read_to_end(&mut sink);

    Some(())
}

fn network() -> ParseOptions {
    ParseOptions::new().allow_network(true)
}

const DOCUMENT: &str = "{\n    name The Name\n}\n";

#[test]
fn an_import_is_read_over_http() {
    serve(
        vec![("/other.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!("import other from {}\n\n{{\n    #other.name\n}}\n", server.url("/other.deon"));

            let value = deon::parse_with(&source, &network()).expect("the import is reachable");

            assert_eq!(
                value,
                Value::Map(
                    [("name".to_string(), Value::string("The Name"))]
                        .into_iter()
                        .collect()
                ),
            );

            // An import asks for Deon, plain text, or JSON.
            let accept = server.requests()[0].accept.clone().unwrap_or_default();
            assert!(accept.contains("application/deon"), "accept was {accept:?}");
        },
    );
}

/// An injection keeps its target exactly, without parsing it.
#[test]
fn an_injection_is_read_over_http_and_not_parsed() {
    serve(
        vec![("/secret.txt", 200, "not deon at all: {{{".to_string())],
        |server| {
            let source = format!(
                "inject secret from {}\n\n{{\n    key #secret\n}}\n",
                server.url("/secret.txt"),
            );

            let value = deon::parse_with(&source, &network()).expect("the injection is reachable");

            assert_eq!(
                value,
                Value::Map(
                    [("key".to_string(), Value::string("not deon at all: {{{"))]
                        .into_iter()
                        .collect()
                ),
            );

            assert_eq!(server.requests()[0].accept.as_deref(), Some("*/*"));
        },
    );
}

/// Naming a link is not the same as being allowed to reach it. The denial must come *before* the
/// request, not after it — so the assertion that matters is that nothing was ever asked for.
#[test]
fn a_denied_import_makes_no_request_at_all() {
    serve(
        vec![("/other.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {}\n\n{{\n    #other.name\n}}\n",
                server.url("/other.deon"),
            );

            // The default: nothing is granted.
            let error = deon::parse(&source).expect_err("the network was not asked for");

            assert_eq!(error.code, DiagnosticCode::CapabilityDenied);
            assert_eq!(server.hits(), 0, "a denied import must not reach the wire");
        },
    );
}

#[test]
fn a_failing_status_is_an_io_error_rather_than_a_denial() {
    serve(vec![("/gone.deon", 404, "gone".to_string())], |server| {
        let source = format!(
            "import other from {}\n\n{{\n    #other.name\n}}\n",
            server.url("/gone.deon"),
        );

        let error = deon::parse_with(&source, &network()).expect_err("404");

        // Allowed, and failed. That is not the same as never allowed.
        assert_eq!(error.code, DiagnosticCode::ResourceIo);
        assert_eq!(server.hits(), 1);
    });
}

/// The `with` written on the declaration is the first source of a credential.
#[test]
fn a_with_authenticator_becomes_a_bearer_token() {
    serve(
        vec![("/private.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {} with secret-token\n\n{{\n    #other.name\n}}\n",
                server.url("/private.deon"),
            );

            deon::parse_with(&source, &network()).expect("reachable");

            assert_eq!(
                server.requests()[0].authorization.as_deref(),
                Some("Bearer secret-token"),
            );
        },
    );
}

/// An authenticator may read the environment, so that a document need hold no secret.
#[test]
fn a_with_authenticator_may_come_from_the_environment() {
    serve(
        vec![("/private.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {} with #$DEON_TEST_TOKEN\n\n{{\n    #other.name\n}}\n",
                server.url("/private.deon"),
            );

            let options = network().environment_variable("DEON_TEST_TOKEN", "from-the-environment");

            deon::parse_with(&source, &options).expect("reachable");

            assert_eq!(
                server.requests()[0].authorization.as_deref(),
                Some("Bearer from-the-environment"),
            );
        },
    );
}

/// The `authorization` option is the fallback, keyed by an exact lowercase hostname.
#[test]
fn the_authorization_option_is_keyed_by_hostname() {
    serve(
        vec![("/private.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {}\n\n{{\n    #other.name\n}}\n",
                server.url("/private.deon"),
            );

            let options = network().authorize("127.0.0.1", "host-token");

            deon::parse_with(&source, &options).expect("reachable");

            assert_eq!(
                server.requests()[0].authorization.as_deref(),
                Some("Bearer host-token"),
            );
        },
    );
}

/// A `with` on the declaration wins over the `authorization` map.
#[test]
fn the_declaration_wins_over_the_authorization_map() {
    serve(
        vec![("/private.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {} with declared\n\n{{\n    #other.name\n}}\n",
                server.url("/private.deon"),
            );

            let options = network().authorize("127.0.0.1", "mapped");

            deon::parse_with(&source, &options).expect("reachable");

            assert_eq!(
                server.requests()[0].authorization.as_deref(),
                Some("Bearer declared"),
            );
        },
    );
}

/// An empty token is no token. `Bearer ` is a credential-shaped nothing, and must not be sent.
#[test]
fn an_empty_token_sends_no_authorization_header() {
    serve(
        vec![("/other.deon", 200, DOCUMENT.to_string())],
        |server| {
            let source = format!(
                "import other from {} with #$DEON_ABSENT_TOKEN\n\n{{\n    #other.name\n}}\n",
                server.url("/other.deon"),
            );

            // An absent environment name is the empty string, never an error.
            let options = network().environment_variable("DEON_ABSENT_TOKEN", "");

            deon::parse_with(&source, &options).expect("reachable");

            assert_eq!(server.requests()[0].authorization, None);
        },
    );
}

/// A document fetched over HTTP resolves its own relative imports over HTTP, against the URL it came
/// from — which is the whole reason `resource_target` has a URL base at all.
#[test]
fn a_relative_import_inside_a_fetched_document_resolves_against_its_url() {
    serve(
        vec![
            (
                "/deep/outer.deon",
                200,
                "import inner from ./inner\n\n{\n    #inner.name\n}\n".to_string(),
            ),
            ("/deep/inner.deon", 200, DOCUMENT.to_string()),
        ],
        |server| {
            let source = format!(
                "import outer from {}\n\n{{\n    ...#outer\n}}\n",
                server.url("/deep/outer.deon"),
            );

            let value = deon::parse_with(&source, &network()).expect("both are reachable");

            assert_eq!(
                value,
                Value::Map(
                    [("name".to_string(), Value::string("The Name"))]
                        .into_iter()
                        .collect()
                ),
            );

            let paths: Vec<String> = server
                .requests()
                .iter()
                .map(|request| request.path.clone())
                .collect();

            assert_eq!(paths, vec!["/deep/outer.deon", "/deep/inner.deon"]);
        },
    );
}

#[test]
fn parse_link_reads_a_document_and_is_denied_without_the_network() {
    serve(vec![("/doc.deon", 200, DOCUMENT.to_string())], |server| {
        let link = server.url("/doc.deon");

        // Denied, and denied before the request.
        let error = deon::parse_link(&link, &ParseOptions::new()).expect_err("denied");

        assert_eq!(error.code, DiagnosticCode::CapabilityDenied);
        assert_eq!(server.hits(), 0);

        // Granted.
        let value = deon::parse_link(&link, &network()).expect("reachable");

        assert_eq!(
            value,
            Value::Map(
                [("name".to_string(), Value::string("The Name"))]
                    .into_iter()
                    .collect()
            ),
        );

        assert_eq!(server.hits(), 1);

        // A link asks for Deon and nothing else, unlike an import.
        assert_eq!(
            server.requests()[0].accept.as_deref(),
            Some("application/deon"),
        );
    });
}

#[test]
fn parse_link_fails_on_a_non_success_status() {
    serve(vec![("/gone.deon", 500, "boom".to_string())], |server| {
        let error = deon::parse_link(&server.url("/gone.deon"), &network()).expect_err("500");

        assert_eq!(error.code, DiagnosticCode::ResourceIo);
        assert!(error.message.contains("500"), "{}", error.message);
    });
}

/// A directory the test owns, so the suite never writes into the real `~/.deon-cache`.
fn scratch_cache(name: &str) -> String {
    let directory = std::env::temp_dir().join(format!("deon-cache-test-{name}"));

    let _ = std::fs::remove_dir_all(&directory);

    directory.to_string_lossy().into_owned()
}

#[test]
fn a_cached_link_is_read_once() {
    serve(vec![("/doc.deon", 200, DOCUMENT.to_string())], |server| {
        let directory = scratch_cache("hit");

        let options = network().cache(true).cache_directory(&directory);
        let link = server.url("/doc.deon");

        let first = deon::parse_link(&link, &options).expect("reachable");
        let second = deon::parse_link(&link, &options).expect("cached");

        assert_eq!(first, second);
        assert_eq!(server.hits(), 1, "the second read came from the cache");

        let _ = std::fs::remove_dir_all(&directory);
    });
}

/// The rule that matters: a document fetched under one credential must never be handed to the holder
/// of another. Alice's cached copy is not Bob's to read.
#[test]
fn a_document_cached_under_one_token_is_not_served_to_another() {
    serve(
        vec![("/private.deon", 200, DOCUMENT.to_string())],
        |server| {
            let directory = scratch_cache("tokens");
            let link = server.url("/private.deon");

            let alice = network()
                .cache(true)
                .cache_directory(&directory)
                .token("alice-token");

            let bob = network()
                .cache(true)
                .cache_directory(&directory)
                .token("bob-token");

            deon::parse_link(&link, &alice).expect("reachable");
            assert_eq!(server.hits(), 1);

            // Alice's entry is on disk. Bob must still go to the wire.
            deon::parse_link(&link, &bob).expect("reachable");
            assert_eq!(server.hits(), 2, "bob must not read alice's cached copy");

            // And each is served their own on a repeat.
            deon::parse_link(&link, &alice).expect("cached");
            deon::parse_link(&link, &bob).expect("cached");
            assert_eq!(server.hits(), 2);

            // The credential is nowhere in the cache directory: not in a name, not in a body.
            for entry in std::fs::read_dir(&directory).expect("the directory exists") {
                let path = entry.expect("an entry").path();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                let body = std::fs::read_to_string(&path).unwrap_or_default();

                assert!(!name.contains("alice") && !name.contains("bob"), "{name}");
                assert!(!body.contains("alice-token") && !body.contains("bob-token"));
            }

            let _ = std::fs::remove_dir_all(&directory);
        },
    );
}

/// An entry carries the duration it was written with, and a stale one is dropped rather than served.
///
/// The entry is forged rather than written by the cache, because "expired" is a statement about the
/// clock: a zero-lifetime entry written and read inside the same millisecond is *not* stale, since
/// the test is `cached_at + duration < now`. Making the suite depend on that would make it depend on
/// how fast the machine is. So the timestamp is simply put in the past, where it plainly belongs.
#[test]
fn a_stale_entry_is_dropped_rather_than_served() {
    serve(vec![("/doc.deon", 200, DOCUMENT.to_string())], |server| {
        let directory = scratch_cache("stale");
        let link = server.url("/doc.deon");

        let options = network().cache(true).cache_directory(&directory);

        std::fs::create_dir_all(&directory).expect("the directory");

        // A cache entry is an ordinary Deon document, which is the whole point of writing it as one.
        let entry = std::path::Path::new(&directory).join(deon::sha::cache_key(&link, ""));

        std::fs::write(
            &entry,
            "{\n    cachedAt 1\n    cacheDuration 1\n    data {\n        name Stale\n    }\n}\n",
        )
        .expect("the entry");

        let value = deon::parse_link(&link, &options).expect("reachable");

        // Not the stale value.
        assert_eq!(
            value,
            Value::Map(
                [("name".to_string(), Value::string("The Name"))]
                    .into_iter()
                    .collect()
            ),
        );

        assert_eq!(server.hits(), 1, "a stale entry must not be served");

        let _ = std::fs::remove_dir_all(&directory);
    });
}

/// A fresh entry *is* served, which is what makes the test above mean something: the entry is being
/// found and read, and rejected for its age rather than for being unreadable.
#[test]
fn a_fresh_entry_is_served_from_disk_without_a_request() {
    serve(vec![("/doc.deon", 200, DOCUMENT.to_string())], |server| {
        let directory = scratch_cache("fresh");
        let link = server.url("/doc.deon");

        let options = network().cache(true).cache_directory(&directory);

        std::fs::create_dir_all(&directory).expect("the directory");

        let entry = std::path::Path::new(&directory).join(deon::sha::cache_key(&link, ""));
        let far_future = u64::MAX / 2;

        std::fs::write(
            &entry,
            format!(
                "{{\n    cachedAt 1\n    cacheDuration {far_future}\n    data {{\n        name Cached\n    }}\n}}\n"
            ),
        )
        .expect("the entry");

        let value = deon::parse_link(&link, &options).expect("cached");

        assert_eq!(
            value,
            Value::Map(
                [("name".to_string(), Value::string("Cached"))]
                    .into_iter()
                    .collect()
            ),
        );

        assert_eq!(server.hits(), 0, "a fresh entry must not reach the wire");

        let _ = std::fs::remove_dir_all(&directory);
    });
}
