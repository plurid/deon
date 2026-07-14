//! The tree a document is read into.
//!
//! Plain discriminated unions, and an evaluator that walks them. There is no `Environment`, no
//! `Expression`/`Statement` pair, and no resolver: that machinery models variables, assignment, and
//! lexical scopes, and Deon has none of the three.

use std::rc::Rc;

use crate::diagnostic::Span;

/// The segments a link navigates: `entity.name` is `["entity", "name"]`.
pub type Reference = Vec<String>;

#[derive(Clone, Debug)]
pub enum ValueNode {
    Scalar {
        value: String,
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
    pub fn scalar(value: impl Into<String>, span: Span) -> Self {
        ValueNode::Scalar {
            value: value.into(),
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
