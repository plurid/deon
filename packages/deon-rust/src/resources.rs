//! Where a resource lives, and whether it may be reached at all.

use std::collections::HashMap;

use crate::options::ParseOptions;
use crate::syntax::{Resource, ResourceKind};
use crate::text::{is_absolute_path, is_url, scheme_of};

/// What a loader hands back.
pub struct Fetched {
    pub data: String,

    /// `.deon`, `.json`, or the empty string for an injection, which keeps its target exactly.
    pub filetype: String,

    /// What a relative target inside the loaded document resolves against.
    pub filebase: String,

    /// The canonical identity of what was actually read, which is what the cycle check compares.
    pub resource_id: String,
}

/// Reads a resource, or does not. A parser built without one cannot reach the filesystem or the
/// network by accident, because it has nothing to reach with (specification 9).
pub trait ResourceLoader {
    fn load(&self, target: &str, kind: ResourceKind, options: &ParseOptions) -> Option<Fetched>;
}

/// A loader that can reach nothing at all.
pub struct DenyAll;

impl ResourceLoader for DenyAll {
    fn load(&self, _target: &str, _kind: ResourceKind, _options: &ParseOptions) -> Option<Fetched> {
        None
    }
}

/// The filesystem, and only when it has been granted.
///
/// There is no network here. A remote target is refused by returning nothing, which the interpreter
/// turns into the denial or the failure that the capability model calls for.
pub struct Filesystem;

impl ResourceLoader for Filesystem {
    fn load(&self, target: &str, kind: ResourceKind, options: &ParseOptions) -> Option<Fetched> {
        // network pass: a remote target would be fetched here.
        if is_url(target) || scheme_of(target).is_some() {
            return None;
        }

        if !options.allow_filesystem {
            return None;
        }

        let file = resolve_mapped_absolute_path(target, &options.absolute_paths);
        let data = std::fs::read_to_string(&file).ok()?;

        Some(Fetched {
            data,
            filetype: extension(&file, kind),
            filebase: directory_of(&file).to_string(),
            resource_id: file,
        })
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
/// holds it, and `..` is folded away so that two spellings of one resource cannot escape the cycle
/// check.
pub fn resource_target(resource: &Resource, options: &ParseOptions) -> String {
    let target = with_import_extension(&resource.target, resource.kind);

    // network pass: a relative URL would resolve against the URL that holds it. Nothing here can
    // reach a remote target, so it is carried through as written and denied by the loader.
    if scheme_of(&target).is_some() {
        return target;
    }

    let source = &options.source_name;
    let filebase = &options.filebase;

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
