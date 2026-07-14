//! What a caller may decide about a parse, and about a stringification.

use std::collections::HashMap;

/// The capabilities and the surroundings of a parse.
///
/// Everything is denied by default. Calling a parser grants neither the filesystem nor the network;
/// each is an explicit decision (specification 9).
#[derive(Clone, Debug)]
pub struct ParseOptions {
    /// What the document is called in a diagnostic, and what a relative target resolves against.
    pub source_name: String,

    /// The directory a relative target resolves against, when it is not the one holding the source.
    pub filebase: String,

    /// Maps a logical absolute target onto the host path that actually holds it (specification 9).
    pub absolute_paths: HashMap<String, String>,

    /// Bearer credentials, keyed by an exact lowercase hostname — no port, no path, no wildcard.
    ///
    /// This is the *fallback*. A `with <token>` written on the declaration itself wins over it.
    pub authorization: HashMap<String, String>,

    /// The credential for [`crate::parse_link`], and half of the cache key. It is deliberately *not*
    /// used by imports and injections, which take their credential from `with` or `authorization`.
    pub token: String,

    pub allow_filesystem: bool,
    pub allow_network: bool,

    /// Whether [`crate::parse_link`] may read and write a cache. Nothing else caches.
    pub cache: bool,

    /// How long a cache entry stands, in milliseconds. Recorded per entry, so changing this does not
    /// invalidate what is already written.
    pub cache_duration: u64,

    /// Empty means `~/.deon-cache`.
    pub cache_directory: String,

    /// The environment a `#$NAME` reads. An absent name is the empty string, never an error.
    pub environment: HashMap<String, String>,

    /// Resources handed over directly, by target, so that a caller may parse a document that
    /// imports without granting it anything at all.
    pub resources: HashMap<String, String>,

    /// The documents already being read, so that a resource cannot import itself.
    pub resource_stack: Vec<String>,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            source_name: "<memory>".to_string(),
            filebase: String::new(),
            absolute_paths: HashMap::new(),
            authorization: HashMap::new(),
            token: String::new(),
            allow_filesystem: false,
            allow_network: false,
            cache: false,
            cache_duration: DEFAULT_CACHE_DURATION,
            cache_directory: String::new(),
            environment: HashMap::new(),
            resources: HashMap::new(),
            resource_stack: Vec::new(),
        }
    }
}

/// One hour, in milliseconds.
pub const DEFAULT_CACHE_DURATION: u64 = 1000 * 60 * 60;

impl ParseOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn source_name(mut self, name: impl Into<String>) -> Self {
        self.source_name = name.into();
        self
    }

    pub fn filebase(mut self, filebase: impl Into<String>) -> Self {
        self.filebase = filebase.into();
        self
    }

    pub fn allow_filesystem(mut self, allow: bool) -> Self {
        self.allow_filesystem = allow;
        self
    }

    pub fn allow_network(mut self, allow: bool) -> Self {
        self.allow_network = allow;
        self
    }

    pub fn resource(mut self, target: impl Into<String>, data: impl Into<String>) -> Self {
        self.resources.insert(target.into(), data.into());
        self
    }

    pub fn environment_variable(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.environment.insert(name.into(), value.into());
        self
    }

    pub fn absolute_path(mut self, from: impl Into<String>, to: impl Into<String>) -> Self {
        self.absolute_paths.insert(from.into(), to.into());
        self
    }

    /// A bearer credential for one host. The key is matched as an exact lowercase hostname.
    pub fn authorize(mut self, hostname: impl Into<String>, token: impl Into<String>) -> Self {
        self.authorization
            .insert(hostname.into().to_ascii_lowercase(), token.into());
        self
    }

    pub fn token(mut self, token: impl Into<String>) -> Self {
        self.token = token.into();
        self
    }

    pub fn cache(mut self, cache: bool) -> Self {
        self.cache = cache;
        self
    }

    pub fn cache_directory(mut self, directory: impl Into<String>) -> Self {
        self.cache_directory = directory.into();
        self
    }

    pub fn cache_duration(mut self, milliseconds: u64) -> Self {
        self.cache_duration = milliseconds;
        self
    }
}

/// How a value is written back out (specification 12).
#[derive(Clone, Debug)]
pub struct StringifyOptions {
    /// The one output that two implementations must agree on, character for character
    /// (specification 13). It implies readable output, four spaces, no leaflinks, no comments, and
    /// map keys sorted by code point.
    pub canonical: bool,

    /// Each entry on its own line. Otherwise the entries are separated by the comma, which the
    /// grammar accepts wherever it accepts a newline.
    pub readable: bool,

    pub indentation: usize,

    /// Lift the containers sitting at `leaflink_level` out of the root and into declarations.
    pub leaflinks: bool,
    pub leaflink_level: usize,

    /// Write `#name` rather than `name #name` when the receiving key is the name of the leaflink.
    pub leaflink_shortening: bool,

    pub generated_header: bool,
    pub generated_comments: bool,
}

impl Default for StringifyOptions {
    fn default() -> Self {
        Self {
            canonical: false,
            readable: true,
            indentation: 4,
            leaflinks: false,
            leaflink_level: 1,
            leaflink_shortening: true,
            generated_header: false,
            generated_comments: false,
        }
    }
}

impl StringifyOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Canonical output is defined as four spaces and a newline, so it is readable by construction.
    pub fn canonical() -> Self {
        Self {
            canonical: true,
            readable: true,
            indentation: 4,
            leaflinks: false,
            leaflink_level: 1,
            leaflink_shortening: true,
            generated_header: false,
            generated_comments: false,
        }
    }

    pub(crate) fn resolved(mut self) -> Self {
        if self.canonical {
            self.readable = true;
            self.leaflinks = false;
            self.generated_header = false;
            self.generated_comments = false;
        }

        self
    }
}
