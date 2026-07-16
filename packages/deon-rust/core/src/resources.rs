//! Where a resource lives, and whether it may be reached at all.

use std::collections::HashMap;

use crate::options::ParseOptions;
use crate::syntax::{Resource, ResourceKind};
use crate::text::{is_absolute_path, is_url, scheme_of};
use crate::url::Url;

/// What a loader hands back.
pub struct Fetched {
    /// The bytes as they were read. A loader answers *whether* a resource could be reached, not
    /// whether what it reached is text: bytes that are not valid UTF-8 were read successfully, so
    /// their encoding is a format fault the interpreter raises when it decodes them, not an I/O one
    /// the loader reports by handing back nothing (specification 1, 9).
    pub data: Vec<u8>,

    /// `.deon`, `.json`, or the empty string for an injection, which keeps its target exactly.
    pub filetype: String,

    /// What a relative target inside the loaded document resolves against.
    pub filebase: String,

    /// The canonical identity of what was actually read, which is what the cycle check compares.
    pub resource_id: String,
}

/// Reads a resource, or does not. A parser built without one cannot reach the filesystem or the
/// network by accident, because it has nothing to reach with (specification 9).
///
/// A host that wants a resource from somewhere this crate does not know about — a database, an
/// archive, an HTTP client of its own choosing — implements this, and needs no feature flag to do it.
///
/// `token` is the bearer credential already decided for this target: the `with` written on the
/// declaration if there is one, otherwise the `authorization` entry for the host. Deciding it is not
/// the loader's job; using it is.
pub trait ResourceLoader {
    fn load(
        &self,
        target: &str,
        kind: ResourceKind,
        options: &ParseOptions,
        token: Option<&str>,
    ) -> Option<Fetched>;
}

/// A loader that can reach nothing at all.
pub struct DenyAll;

impl ResourceLoader for DenyAll {
    fn load(
        &self,
        _target: &str,
        _kind: ResourceKind,
        _options: &ParseOptions,
        _token: Option<&str>,
    ) -> Option<Fetched> {
        None
    }
}

/// The filesystem, and only when it has been granted.
///
/// A remote target is not this loader's business, so it is refused by returning nothing — which the
/// interpreter turns into the denial or the failure that the capability model calls for. Reaching a
/// remote target is [`crate::network::Http`]'s job, and it exists only behind the `network` feature.
pub struct Filesystem;

impl ResourceLoader for Filesystem {
    fn load(
        &self,
        target: &str,
        kind: ResourceKind,
        options: &ParseOptions,
        _token: Option<&str>,
    ) -> Option<Fetched> {
        if is_url(target) || scheme_of(target).is_some() {
            return None;
        }

        if !options.allow_filesystem {
            return None;
        }

        let file = resolve_mapped_absolute_path(target, &options.absolute_paths);

        // The bytes, as they are. A file that is not there or may not be read is `None`, which the
        // interpreter turns into an I/O failure; a file that is there but is not UTF-8 is read
        // successfully here and judged a format fault when the interpreter decodes it (specification
        // 1, 9). Reading to a `String` would collapse the two into one indistinguishable `None`.
        let data = std::fs::read(&file).ok()?;

        Some(Fetched {
            data,
            filetype: extension(&file, kind),
            filebase: directory_of(&file).to_string(),
            resource_id: file,
        })
    }
}

/// Everything this crate itself knows how to reach: the filesystem, and — with the `network` feature
/// — a remote target.
///
/// Neither is granted here. Each sub-loader refuses on its own unless the matching capability was
/// asked for, so the capability model is enforced in one place per capability rather than at every
/// call site (specification 9).
pub struct Host;

impl ResourceLoader for Host {
    fn load(
        &self,
        target: &str,
        kind: ResourceKind,
        options: &ParseOptions,
        token: Option<&str>,
    ) -> Option<Fetched> {
        #[cfg(feature = "network")]
        if let Some(fetched) = crate::network::Http.load(target, kind, options, token) {
            return Some(fetched);
        }

        Filesystem.load(target, kind, options, token)
    }
}

/// Maps a logical absolute target onto the host path that actually holds it (specification 9).
///
/// An exact key wins before any wildcard. Among the wildcards, which end in `/*`, the longest prefix
/// wins, and whatever of the target the prefix did not match is appended to the mapped directory.
///
/// This is applied before the loader, rather than inside it, because the mapping is a property of
/// the target and not of whoever resolves it: a resource handed over through `resources` must map
/// exactly as one read from a disk, or the same document would mean two different things.
pub fn resolve_mapped_absolute_path(file: &str, mappings: &HashMap<String, String>) -> String {
    // Only an absolute target is logical. A relative one resolves against the document holding it.
    if !is_absolute_path(file) {
        return file.to_string();
    }

    if let Some(mapped) = mappings.get(file) {
        return mapped.clone();
    }

    let wildcard = mappings
        .keys()
        .filter(|key| key.ends_with("/*") && file.starts_with(&key[..key.len() - 1]))
        .max_by_key(|key| key.len());

    let Some(wildcard) = wildcard else {
        return file.to_string();
    };

    let prefix = &wildcard[..wildcard.len() - 1];
    let suffix = &file[prefix.len()..];
    let directory = mappings[wildcard].trim_end_matches('/');

    format!("{directory}/{suffix}")
}

/// The canonical identity of a resource. A relative filesystem target resolves against the file that
/// holds it, a relative URL against the URL that holds it, and `..` is folded away so that two
/// spellings of one resource cannot escape the cycle check.
pub fn resource_target(resource: &Resource, options: &ParseOptions) -> String {
    let target = with_import_extension(&resource.target, resource.kind);

    // A target with a scheme of its own is not relative to anything.
    if scheme_of(&target).is_some() {
        return match Url::parse(&target) {
            Some(url) => url.href(),
            None => target,
        };
    }

    let source = &options.source_name;
    let filebase = &options.filebase;

    // A document read over HTTP resolves its own relative imports over HTTP.
    //
    // The asymmetry is deliberate, and is the reference's: a `filebase` is a *directory*, so it is
    // given a trailing slash and the reference is appended to it, whereas a `source_name` is the
    // *document* itself, so the reference replaces its last segment.
    let url_base = if is_url(filebase) {
        Some(format!("{}/", filebase.trim_end_matches('/')))
    } else if is_url(source) {
        Some(source.clone())
    } else {
        None
    };

    if let Some(url_base) = url_base {
        if let Some(base) = Url::parse(&url_base) {
            return base.join(&target).href();
        }
    }

    let normalized = target.replace('\\', "/");
    let absolute = is_absolute_path(&normalized);

    let base = if !filebase.is_empty() {
        filebase.as_str()
    } else {
        directory_of(source)
    };

    // An absolute target stands on its own, and a relative one with nothing to stand against is
    // taken as written.
    let joined = if absolute || base.is_empty() {
        normalized
    } else {
        format!("{base}/{normalized}")
    };

    normalize_path(&joined)
}

/// The `authorization` option is keyed by an exact lowercase hostname — no port, no path, no
/// wildcard. A target that is not remote gets no token at all.
pub fn authorization(target: &str, options: &ParseOptions) -> Option<String> {
    if !is_url(target) {
        return None;
    }

    let url = Url::parse(target)?;

    options.authorization.get(url.hostname()).cloned()
}

/// Folds `.` and `..` away. Above the root there is nothing, so a rooted path drops what it cannot
/// climb.
fn normalize_path(joined: &str) -> String {
    let drive = match joined.as_bytes() {
        [letter, b':', ..] if letter.is_ascii_alphabetic() => &joined[..2],
        _ => "",
    };

    let rest = &joined[drive.len()..];
    let rooted = rest.starts_with('/') || !drive.is_empty();

    let mut normalized: Vec<&str> = Vec::new();

    for part in rest.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                if normalized.last().is_some_and(|last| *last != "..") {
                    normalized.pop();
                } else if !rooted {
                    normalized.push(part);
                }
            }
            _ => normalized.push(part),
        }
    }

    let root = if rest.starts_with('/') { "/" } else { "" };

    format!("{drive}{root}{}", normalized.join("/"))
}

/// An import target with no extension is a Deon document. The query and the fragment are not part of
/// the path, so the extension goes before them.
pub fn with_import_extension(target: &str, kind: ResourceKind) -> String {
    if kind != ResourceKind::Import {
        return target.to_string();
    }

    let suffix_at = target.find(['?', '#']);

    let (pathname, suffix) = match suffix_at {
        Some(at) => (&target[..at], &target[at..]),
        None => (target, ""),
    };

    let slash = pathname
        .rfind(['/', '\\'])
        .map(|at| at as isize)
        .unwrap_or(-1);

    let dot = pathname.rfind('.').map(|at| at as isize).unwrap_or(-1);

    if dot > slash {
        return target.to_string();
    }

    format!("{pathname}.deon{suffix}")
}

/// An injection keeps its target exactly, without parsing it, so it has no format at all.
pub fn extension(target: &str, kind: ResourceKind) -> String {
    if kind == ResourceKind::Inject {
        return String::new();
    }

    let clean = match target.find(['?', '#']) {
        Some(at) => &target[..at],
        None => target,
    };

    let slash = clean.rfind('/').map(|at| at as isize).unwrap_or(-1);
    let dot = clean.rfind('.').map(|at| at as isize).unwrap_or(-1);

    if dot > slash {
        clean[dot as usize..].to_lowercase()
    } else {
        ".deon".to_string()
    }
}

pub fn directory_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(at) => &path[..at],
        None => "",
    }
}
