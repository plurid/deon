//! Reaching a remote target. Only compiled with the `network` feature.
//!
//! This is the *only* place in the crate that opens a socket. Everything else — the scanner, the
//! parser, the evaluator, the stringifier — is pure, and stays pure whether the feature is on or off.

use std::time::Duration;

use crate::diagnostic::{resource_err, DResult, DiagnosticCode};
use crate::options::ParseOptions;
use crate::resources::{extension, Fetched, ResourceLoader};
use crate::syntax::ResourceKind;
use crate::text::is_url;
use crate::value::Value;

const DEON_MEDIA_TYPE: &str = "application/deon";

/// What an import will take back, in order of preference. An injection takes anything, because it
/// keeps whatever it is given exactly.
fn accept(kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Import => "text/plain,application/json,application/deon",
        ResourceKind::Inject => "*/*",
    }
}

const TIMEOUT: Duration = Duration::from_secs(30);

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .build()
        .into()
}

/// Fetches the body of `url`, or nothing.
///
/// A failure — any status outside 200–299, a refused connection, a timeout — is `None` rather than an
/// error, because the interpreter is what decides what a missing resource *means*: a refusal if the
/// capability was never granted, a failure if it was. Deciding that here would lose the distinction.
fn get(url: &str, headers: &[(&str, &str)]) -> Option<String> {
    let mut request = agent().get(url);

    for (name, value) in headers {
        request = request.header(*name, *value);
    }

    let mut response = request.call().ok()?;

    if !(200..300).contains(&response.status().as_u16()) {
        return None;
    }

    response.body_mut().read_to_string().ok()
}

/// The network, and only when it has been granted.
pub struct Http;

impl ResourceLoader for Http {
    fn load(
        &self,
        target: &str,
        kind: ResourceKind,
        options: &ParseOptions,
        token: Option<&str>,
    ) -> Option<Fetched> {
        if !is_url(target) {
            return None;
        }

        if !options.allow_network {
            return None;
        }

        let mut headers: Vec<(&str, &str)> = vec![("Accept", accept(kind))];

        // An empty token is no token. Sending `Bearer ` would be a credential-shaped nothing.
        let bearer;
        if let Some(token) = token.filter(|token| !token.is_empty()) {
            bearer = format!("Bearer {token}");
            headers.push(("Authorization", &bearer));
        }

        let data = get(target, &headers)?;

        Some(Fetched {
            data,
            filetype: extension(target, kind),

            // Deliberately empty. A relative import inside a document fetched over HTTP resolves
            // against the *URL* it came from, which `resource_target` does from `source_name`.
            filebase: String::new(),

            resource_id: target.to_string(),
        })
    }
}

/// Reads a Deon document straight from a link.
///
/// Naming a link is not the same as being allowed to reach it, so the capability is checked *before*
/// the request rather than after it: a denied link makes no request at all (specification 9).
pub fn parse_link(link: &str, options: &ParseOptions) -> DResult<Value> {
    if !options.allow_network {
        return resource_err(
            DiagnosticCode::CapabilityDenied,
            format!("Reading '{link}' requires network access."),
            link,
        );
    }

    if let Some(cached) = crate::cache::read(link, options) {
        return Ok(cached);
    }

    // A link is asked for as Deon and nothing else, which is not what an `import` asks for — an
    // import will take plain text or JSON as well.
    let mut headers: Vec<(&str, &str)> = vec![("Accept", DEON_MEDIA_TYPE)];

    let bearer;
    if !options.token.is_empty() {
        bearer = format!("Bearer {}", options.token);
        headers.push(("Authorization", &bearer));
    }

    let mut request = agent().get(link);

    for (name, value) in &headers {
        request = request.header(*name, *value);
    }

    let mut response = match request.call() {
        Ok(response) => response,
        Err(error) => {
            return resource_err(
                DiagnosticCode::ResourceIo,
                format!("Unable to read '{link}': {error}."),
                link,
            );
        }
    };

    let status = response.status().as_u16();

    if !(200..300).contains(&status) {
        return resource_err(
            DiagnosticCode::ResourceIo,
            format!("Unable to read '{link}': HTTP {status}."),
            link,
        );
    }

    let body = match response.body_mut().read_to_string() {
        Ok(body) => body,
        Err(error) => {
            return resource_err(
                DiagnosticCode::ResourceIo,
                format!("Unable to read '{link}': {error}."),
                link,
            );
        }
    };

    let mut nested = options.clone();
    nested.source_name = link.to_string();

    let value = crate::parse_with(&body, &nested)?;

    crate::cache::write(link, &value, options);

    Ok(value)
}
