//! Just enough of a URL to say what a resource *is*.
//!
//! A resource's canonical identity is what the cycle check compares, so two spellings of one remote
//! document must fold to one string — which means resolving a relative reference against the URL that
//! holds it, and normalizing what comes out. That is `new URL(reference, base).href` in the reference
//! implementation, and this is that, to the depth the language actually needs (RFC 3986 §5.2).
//!
//! It is deliberately not a general URL library: no percent-encoding normalization, no IDNA, no
//! punycode. It is here to identify a document, not to be a browser.

/// The parts of an absolute URL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Url {
    /// Lowercased, without the colon.
    pub scheme: String,
    pub userinfo: Option<String>,
    /// Lowercased. A host is case-insensitive; a path is not.
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
    pub query: Option<String>,
    pub fragment: Option<String>,
}

/// The port a scheme already implies, and which therefore must not be written down: `example.com:443`
/// and `example.com` are the same host, and a cycle check that thought otherwise would be wrong.
fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    }
}

impl Url {
    /// Reads an absolute URL: `scheme://authority/path?query#fragment`.
    pub fn parse(input: &str) -> Option<Self> {
        let at = input.find("://")?;
        let scheme = &input[..at];

        let mut characters = scheme.chars();

        if !characters.next()?.is_ascii_alphabetic() {
            return None;
        }

        if !characters.all(|character| {
            character.is_ascii_alphanumeric()
                || character == '+'
                || character == '.'
                || character == '-'
        }) {
            return None;
        }

        let rest = &input[at + 3..];

        // The authority ends at the first of these; everything after belongs to the path.
        let end = rest
            .find(['/', '?', '#'])
            .unwrap_or(rest.len());

        let authority = &rest[..end];
        let tail = &rest[end..];

        let (userinfo, hostport) = match authority.rfind('@') {
            Some(at) => (Some(authority[..at].to_string()), &authority[at + 1..]),
            None => (None, authority),
        };

        // A colon inside brackets belongs to an IPv6 literal, not to a port.
        let (host, port) = match hostport.rfind(':') {
            Some(at) if !hostport[at..].contains(']') => {
                let port = hostport[at + 1..].parse::<u16>().ok();

                // A colon with nothing after it is not a port, and the empty string parses as
                // nothing, so only take the split when a number actually followed.
                if port.is_some() || hostport[at + 1..].is_empty() {
                    (&hostport[..at], port)
                } else {
                    return None;
                }
            }
            _ => (hostport, None),
        };

        let (before_fragment, fragment) = match tail.find('#') {
            Some(at) => (&tail[..at], Some(tail[at + 1..].to_string())),
            None => (tail, None),
        };

        let (path, query) = match before_fragment.find('?') {
            Some(at) => (
                &before_fragment[..at],
                Some(before_fragment[at + 1..].to_string()),
            ),
            None => (before_fragment, None),
        };

        let scheme = scheme.to_ascii_lowercase();
        let port = port.filter(|port| default_port(&scheme) != Some(*port));

        Some(Self {
            scheme,
            userinfo,
            host: host.to_ascii_lowercase(),
            port,
            path: if path.is_empty() {
                "/".to_string()
            } else {
                remove_dot_segments(path)
            },
            query,
            fragment,
        })
    }

    /// `new URL(reference, base)` — RFC 3986 §5.2.
    pub fn join(&self, reference: &str) -> Url {
        // A reference with a scheme of its own is not relative to anything.
        if let Some(absolute) = Url::parse(reference) {
            return absolute;
        }

        let mut resolved = self.clone();

        // A scheme-relative reference keeps only the scheme.
        if let Some(rest) = reference.strip_prefix("//") {
            if let Some(absolute) = Url::parse(&format!("{}://{}", self.scheme, rest)) {
                return absolute;
            }
        }

        let (before_fragment, fragment) = match reference.find('#') {
            Some(at) => (&reference[..at], Some(reference[at + 1..].to_string())),
            None => (reference, None),
        };

        let (path, query) = match before_fragment.find('?') {
            Some(at) => (
                &before_fragment[..at],
                Some(before_fragment[at + 1..].to_string()),
            ),
            None => (before_fragment, None),
        };

        resolved.fragment = fragment;

        if path.is_empty() {
            // Only a query, or only a fragment: the path stays as it is.
            if query.is_some() {
                resolved.query = query;
            }

            return resolved;
        }

        resolved.query = query;

        resolved.path = if path.starts_with('/') {
            remove_dot_segments(path)
        } else {
            // §5.3 merge: the reference replaces everything after the base's last slash.
            let base = match self.path.rfind('/') {
                Some(at) => &self.path[..=at],
                None => "/",
            };

            remove_dot_segments(&format!("{base}{path}"))
        };

        resolved
    }

    /// The hostname alone, lowercased and without the port. The `authorization` option is keyed by
    /// exactly this.
    pub fn hostname(&self) -> &str {
        &self.host
    }

    /// The URL written back out, normalized — which is what makes it an identity.
    pub fn href(&self) -> String {
        let mut out = format!("{}://", self.scheme);

        if let Some(userinfo) = &self.userinfo {
            out.push_str(userinfo);
            out.push('@');
        }

        out.push_str(&self.host);

        if let Some(port) = self.port {
            out.push_str(&format!(":{port}"));
        }

        out.push_str(if self.path.is_empty() {
            "/"
        } else {
            &self.path
        });

        if let Some(query) = &self.query {
            out.push('?');
            out.push_str(query);
        }

        if let Some(fragment) = &self.fragment {
            out.push('#');
            out.push_str(fragment);
        }

        out
    }
}

/// RFC 3986 §5.2.4. Above the root there is nothing, so a `..` that cannot climb is dropped rather
/// than kept.
fn remove_dot_segments(path: &str) -> String {
    let rooted = path.starts_with('/');
    let trailing = path.ends_with('/') || path.ends_with("/.") || path.ends_with("/..");

    let mut out: Vec<&str> = Vec::new();

    for segment in path.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                out.pop();
            }
            _ => out.push(segment),
        }
    }

    let mut resolved = String::new();

    if rooted {
        resolved.push('/');
    }

    resolved.push_str(&out.join("/"));

    if trailing && !resolved.ends_with('/') {
        resolved.push('/');
    }

    resolved
}
