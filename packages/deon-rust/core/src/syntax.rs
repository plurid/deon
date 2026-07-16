//! The tree a document is read into.
//!
//! Plain discriminated unions, and an evaluator that walks them. There is no `Environment`, no
//! `Expression`/`Statement` pair, and no resolver: that machinery models variables, assignment, and
//! lexical scopes, and Deon has none of the three.

use std::rc::Rc;

use crate::diagnostic::Span;

/// A link's head and the segments that navigate from it. `entity.name` is head `entity` with one
/// key access `name`; `items[0]` is head `items` with one index access.
///
/// The head is a leaflink name, a local, a quoted name, or an environment name carrying its `$`. The
/// distinction the segments preserve is the one a flat list of strings could not: whether a step is a
/// map key or a list index (specification 6). A dot segment is always a key; a bracket segment is a
/// list index only when its content is a run of decimal digits, and a key otherwise — so `l['1']` and
/// `l.0` look up a key while `l[1]` reads a position, and the three can no longer be confused after
/// parsing has forgotten how they were written.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reference {
    pub head: String,
    pub access: Vec<Access>,
}

/// One navigation step after the head.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Access {
    /// A dot segment, or a quoted or non-all-digit bracket segment: always a map key.
    Key(String),

    /// A bracket segment whose content is a run of decimal digits (leading zeros permitted). Against a
    /// list it reads the position `index`; against a map it is the key `text`. `index` is `None` when
    /// the digits overflow the machine index, which is well-formed but names no position a list holds.
    Index { text: String, index: Option<usize> },
}

impl Access {
    /// The written text of the segment: the key, or the digits of an index.
    pub fn text(&self) -> &str {
        match self {
            Access::Key(text) => text,
            Access::Index { text, .. } => text,
        }
    }
}

impl Reference {
    /// The map key a shortened link or call contributes: the final access segment's text, or the head
    /// with any environment sigil removed (specification 6).
    pub fn receiving_key(&self) -> &str {
        match self.access.last() {
            Some(access) => access.text(),
            None => self.head.strip_prefix('$').unwrap_or(&self.head),
        }
    }

    /// A stable identifier for the whole reference, for cycle detection over a call.
    pub fn identity(&self) -> String {
        let mut identity = self.head.clone();

        for access in &self.access {
            identity.push('.');
            identity.push_str(access.text());
        }

        identity
    }
}

#[derive(Clone, Debug)]
pub enum ValueNode {
    Scalar {
        value: String,
        /// A scalar parsed from source is decoded — its `#{…}` interpolations and escapes read —
        /// when it is evaluated. A scalar rebuilt from an already-final value (an injected resource,
        /// which §9 binds without parsing, or an imported one, whose strings were resolved as it was
        /// read) is `literal`: its text is the value itself, and evaluating it must not decode it a
        /// second time, or an injected `#{x}` would resolve where it should stay literal.
        literal: bool,
        span: Span,
    },
    Link {
        reference: Reference,
        span: Span,
    },
    Call {
        reference: Reference,
        arguments: Vec<CallArgument>,
        span: Span,
    },
    Map {
        entries: Vec<MapItem>,
        span: Span,
    },
    List {
        items: Vec<ListItem>,
        span: Span,
    },
    /// A list of maps written as a table: a signature, and the rows under it.
    Structure {
        fields: Vec<String>,
        rows: Vec<Vec<ValueNode>>,
        span: Span,
    },
}

impl ValueNode {
    /// A scalar parsed from source: decoded when it is evaluated.
    pub fn scalar(value: impl Into<String>, span: Span) -> Self {
        ValueNode::Scalar {
            value: value.into(),
            literal: false,
            span,
        }
    }

    /// A scalar rebuilt from an already-final value (an injected or imported resource): kept exactly
    /// when it is evaluated, never decoded a second time (§9).
    pub fn literal_scalar(value: impl Into<String>, span: Span) -> Self {
        ValueNode::Scalar {
            value: value.into(),
            literal: true,
            span,
        }
    }

    pub fn span(&self) -> &Span {
        match self {
            ValueNode::Scalar { span, .. }
            | ValueNode::Link { span, .. }
            | ValueNode::Call { span, .. }
            | ValueNode::Map { span, .. }
            | ValueNode::List { span, .. }
            | ValueNode::Structure { span, .. } => span,
        }
    }
}

#[derive(Clone, Debug)]
pub struct CallArgument {
    pub name: String,
    pub value: ValueNode,
    pub span: Span,
}

#[derive(Clone, Debug)]
pub enum MapItem {
    /// `key value`.
    Entry {
        name: String,
        value: ValueNode,
        span: Span,
    },

    /// The shortened form, which takes its receiving key from the last segment of the link. The
    /// value is always a `Link` or a `Call`; the parser is what holds that true.
    Link { value: ValueNode, span: Span },

    Spread { reference: Reference, span: Span },
}

#[derive(Clone, Debug)]
pub enum ListItem {
    Value(ValueNode),
    Spread { reference: Reference, span: Span },
}

#[derive(Clone, Debug)]
pub struct Leaflink {
    pub name: String,
    pub value: ValueNode,
    pub span: Span,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Import,
    Inject,
}

#[derive(Clone, Debug)]
pub struct Resource {
    pub kind: ResourceKind,
    pub name: String,
    pub target: String,
    pub authenticator: Option<ValueNode>,
    pub span: Span,
}

/// Imports, injections, and leaflinks share one namespace, so a name may be declared only once
/// (specification 3).
#[derive(Clone, Debug)]
pub enum Declaration {
    Leaflink(Leaflink),
    Resource(Resource),
}

impl Declaration {
    pub fn name(&self) -> &str {
        match self {
            Declaration::Leaflink(leaflink) => &leaflink.name,
            Declaration::Resource(resource) => &resource.name,
        }
    }

    pub fn span(&self) -> &Span {
        match self {
            Declaration::Leaflink(leaflink) => &leaflink.span,
            Declaration::Resource(resource) => &resource.span,
        }
    }
}

/// Any number of declarations around exactly one root, written in any order (specification 3).
#[derive(Clone, Debug)]
pub struct Document {
    pub declarations: Vec<Declaration>,

    /// A map or a list; the parser accepts nothing else as a root.
    pub root: ValueNode,

    pub source: Rc<str>,
}
