//! The predicates that a host with a regular-expression engine would write as patterns. There is no
//! engine here, and for nine fixed patterns there does not need to be one.

/// `^[A-Za-z0-9_-]+$` — a name that may be written without quotes.
pub fn is_bare_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

/// `^(0|[1-9][0-9]*)$` — an index into a list. No leading zeroes, so `01` is not an index.
pub fn is_list_index(value: &str) -> bool {
    match value.as_bytes() {
        [] => false,
        [b'0'] => true,
        [b'0', ..] => false,
        digits => digits.iter().all(|byte| byte.is_ascii_digit()),
    }
}

/// `^-?(0|[1-9][0-9]*)$` — an integer as the conservative typer means it (specification 14).
pub fn is_typer_integer(value: &str) -> bool {
    is_list_index(value.strip_prefix('-').unwrap_or(value))
}

/// `^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$` — a decimal as the conservative typer means it.
pub fn is_typer_decimal(value: &str) -> bool {
    let value = value.strip_prefix('-').unwrap_or(value);

    let (mantissa, exponent) = match value.find(['e', 'E']) {
        Some(at) => (&value[..at], Some(&value[at + 1..])),
        None => (value, None),
    };

    let (whole, fraction) = match mantissa.find('.') {
        Some(at) => (&mantissa[..at], Some(&mantissa[at + 1..])),
        None => (mantissa, None),
    };

    if !is_list_index(whole) {
        return false;
    }

    if let Some(fraction) = fraction {
        if fraction.is_empty() || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }

    if let Some(exponent) = exponent {
        let digits = exponent
            .strip_prefix(['+', '-'])
            .unwrap_or(exponent);

        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }

    true
}

/// `^[A-Za-z][A-Za-z0-9+.-]*://` — the scheme of a remote target, if it has one.
pub fn scheme_of(target: &str) -> Option<&str> {
    let at = target.find("://")?;
    let scheme = &target[..at];

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

    Some(scheme)
}

/// `^https?://` — the only remote scheme the language knows how to reach.
pub fn is_url(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();

    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Absolute in the sense the language means it, rather than the sense a particular host means it: a
/// rooted path, or a path on a named drive.
pub fn is_absolute_path(value: &str) -> bool {
    if value.starts_with('/') {
        return true;
    }

    let bytes = value.as_bytes();

    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

/// The characters that would be read as syntax if a string were written without quotes.
///
/// `^#|^\.\.\.#|\\|[\[\]{},()<>]|//|/\*|#\{|['`]`
pub fn is_unsafe_scalar(value: &str) -> bool {
    if value.starts_with('#') || value.starts_with("...#") {
        return true;
    }

    if value.contains("//") || value.contains("/*") || value.contains("#{") {
        return true;
    }

    value.chars().any(|character| {
        matches!(
            character,
            '\\' | '[' | ']' | '{' | '}' | ',' | '(' | ')' | '<' | '>' | '\'' | '`'
        )
    })
}

/// The interpolations written in a string: `#{([^}]+)}`.
///
/// The inner text may hold anything but a closing brace, and it may not be empty, so `#{}` is not an
/// interpolation at all but the three characters it looks like.
///
/// Returns, for each, the byte range it occupies and the text inside it.
pub fn interpolations(input: &str) -> Vec<(usize, usize, &str)> {
    let bytes = input.as_bytes();
    let mut found = Vec::new();
    let mut index = 0;

    while index + 1 < bytes.len() {
        if bytes[index] != b'#' || bytes[index + 1] != b'{' {
            index += 1;
            continue;
        }

        let opened = index + 2;

        match input[opened..].find('}') {
            // `[^}]+` is one or more, so an empty pair is not a match, and the scan carries on from
            // inside it exactly as a regular-expression engine would.
            Some(0) | None => index += 1,
            Some(offset) => {
                let closed = opened + offset;

                found.push((index, closed + 1, &input[opened..closed]));
                index = closed + 1;
            }
        }
    }

    found
}

/// The JSON number grammar: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
///
/// Returns how many bytes of `input` the number occupies, so that the caller can keep the source
/// spelling rather than a value parsed out of it (specification 9.1).
pub fn json_number_length(input: &str) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut index = 0;

    if bytes.first() == Some(&b'-') {
        index += 1;
    }

    match bytes.get(index) {
        Some(b'0') => index += 1,
        Some(byte) if byte.is_ascii_digit() => {
            while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
                index += 1;
            }
        }
        _ => return None,
    }

    if bytes.get(index) == Some(&b'.') {
        let fraction = index + 1;

        if !bytes.get(fraction).is_some_and(|byte| byte.is_ascii_digit()) {
            return Some(index);
        }

        index = fraction;

        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
        }
    }

    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        let mut exponent = index + 1;

        if matches!(bytes.get(exponent), Some(b'+' | b'-')) {
            exponent += 1;
        }

        if bytes.get(exponent).is_some_and(|byte| byte.is_ascii_digit()) {
            index = exponent;

            while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
                index += 1;
            }
        }
    }

    Some(index)
}
