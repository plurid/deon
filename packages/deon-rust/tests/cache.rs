//! The cache, and the hash that names its entries.
//!
//! Specification 9 makes two demands of a cached document, and they are the two things asserted here:
//! a credential must never appear in a cache identifier in plain text, and a document fetched under
//! one token must never be served to the holder of another.

#![cfg(feature = "network")]

use deon::sha::{cache_key, sha256_hex};

/// FIPS 180-4, and the empty string, which is the one every broken implementation gets wrong.
#[test]
fn the_hash_is_actually_sha256() {
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert_eq!(
        sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );

    // Crosses a block boundary, which is where the padding goes wrong if it is going to.
    assert_eq!(
        sha256_hex(&[b'a'; 1_000_000]),
        "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
}

/// The token is hashed with the name, so it is nowhere in the identifier.
#[test]
fn a_token_never_appears_in_a_cache_identifier() {
    let key = cache_key("https://example.com/doc.deon", "super-secret-token");

    assert!(!key.contains("super-secret-token"));
    assert!(!key.contains("secret"));
    assert_eq!(key.len(), 64, "a sha-256 digest, as hexadecimal");
    assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
}

/// The name and the token are joined by a NUL — a byte neither can contain — so no pair of them can
/// collide with another by running together.
#[test]
fn a_different_token_is_a_different_entry() {
    let link = "https://example.com/doc.deon";

    let anonymous = cache_key(link, "");
    let alice = cache_key(link, "alice-token");
    let bob = cache_key(link, "bob-token");

    assert_ne!(alice, bob, "two holders must not share one entry");
    assert_ne!(alice, anonymous);
    assert_ne!(bob, anonymous);

    // And the same pair is always the same entry, or nothing would ever hit.
    assert_eq!(alice, cache_key(link, "alice-token"));
}

/// The separator is what stops `("ab", "c")` and `("a", "bc")` from naming one entry.
#[test]
fn the_separator_prevents_a_collision() {
    assert_ne!(cache_key("ab", "c"), cache_key("a", "bc"));
}
