//! The cache behind [`crate::parse_link`]. Nothing else caches.
//!
//! An entry is itself a Deon document, written canonically. That is not a flourish: reading a value
//! back out of its canonical form is exactly the round-trip the specification already guarantees
//! (13), so the cache rests on a property the conformance suite proves, rather than on a second
//! serializer that could disagree with the first.
//!
//! Every failure here is silent. A cache that cannot be read is a cache miss, and a cache that cannot
//! be written is a cache that was not written; neither is a reason to fail a parse.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::options::ParseOptions;
use crate::sha::cache_key;
use crate::value::{Map, Value};

fn now_milliseconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// The file an entry lives in. Its name *is* the digest of the link and the credential, so a token
/// appears nowhere in it, and a document fetched under one token cannot be served to the holder of
/// another (specification 9).
fn entry_path(name: &str, options: &ParseOptions) -> Option<PathBuf> {
    let directory = if options.cache_directory.is_empty() {
        let home = std::env::var_os("HOME")?;

        PathBuf::from(home).join(".deon-cache")
    } else {
        PathBuf::from(&options.cache_directory)
    };

    Some(directory.join(cache_key(name, &options.token)))
}

pub fn read(name: &str, options: &ParseOptions) -> Option<Value> {
    if !options.cache {
        return None;
    }

    let path = entry_path(name, options)?;
    let source = std::fs::read_to_string(&path).ok()?;

    // A cache entry is a document like any other, and it needs no capabilities to read: it is data
    // this crate wrote, and it holds no imports.
    let Ok(Value::Map(entry)) = crate::parse(&source) else {
        return None;
    };

    let cached_at: u64 = entry.get("cachedAt")?.as_str()?.parse().ok()?;
    let duration: u64 = entry.get("cacheDuration")?.as_str()?.parse().ok()?;

    // An entry carries the duration it was written with, so changing the option does not silently
    // extend what is already on disk.
    if cached_at.saturating_add(duration) < now_milliseconds() {
        let _ = std::fs::remove_file(&path);

        return None;
    }

    Some(entry.get("data")?.clone())
}

pub fn write(name: &str, value: &Value, options: &ParseOptions) {
    if !options.cache {
        return;
    }

    let Some(path) = entry_path(name, options) else {
        return;
    };

    let mut entry = Map::new();
    entry.insert("cachedAt", Value::string(now_milliseconds().to_string()));
    entry.insert(
        "cacheDuration",
        Value::string(options.cache_duration.to_string()),
    );
    entry.insert("data", value.clone());

    if let Some(directory) = path.parent() {
        if std::fs::create_dir_all(directory).is_err() {
            return;
        }
    }

    // A cache write is best-effort, and a value too deep to write canonically simply goes uncached
    // rather than taking a failure anywhere: the caller asked to store something, not to be told it
    // could not.
    if let Ok(written) = crate::canonical(&Value::Map(entry)) {
        let _ = std::fs::write(&path, written);
    }
}
