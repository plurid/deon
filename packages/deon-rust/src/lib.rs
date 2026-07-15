//! Deon — the DeObject Notation Format of Structured Strings.
//!
//! A Deon value is exactly one of three things: a string, an ordered list, or an ordered map. There
//! is no null, no boolean, and no number (specification 2); [`typed`] is where a host says what its
//! own types make of them.
//!
//! Nothing here reaches the filesystem or the network unless it is asked to. Calling [`parse`]
//! grants neither: a document that imports will be told it may not (specification 9).
//!
//! ```
//! let value = deon::parse("{\n    greeting hello\n}\n").unwrap();
//!
//! assert_eq!(value, deon::Value::Map(
//!     [("greeting".to_string(), deon::Value::string("hello"))].into_iter().collect(),
//! ));
//! ```
//!
//! A document that is known at build time can be written inline with the [`deon!`] macro, or read
//! from a file with [`include_deon!`]. Both parse at compile time, so a malformed document is a
//! compile error rather than a runtime one:
//!
//! ```
//! use deon::deon;
//!
//! let value = deon!("{\n    greeting hello\n}\n");
//!
//! assert_eq!(value, deon::Value::Map(
//!     [("greeting".to_string(), deon::Value::string("hello"))].into_iter().collect(),
//! ));
//! ```
//!
//! `deon` is a facade: the parser, the evaluator, and the canonical writer live in `deon-core` and
//! are re-exported here in full, and the macros come from `deon-macros`. The split is what lets the
//! macros run the parser at compile time without a dependency cycle; a caller depends only on `deon`.

#![forbid(unsafe_code)]

pub use deon_core::*;
pub use deon_macros::{deon, include_deon};
