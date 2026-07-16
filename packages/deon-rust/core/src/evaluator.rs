//! A tree into a value.
//!
//! Everything a resource could need has already been loaded by the interpreter, so nothing here
//! reaches for the filesystem or the network. That is not a convention; it is why the type has no
//! way to.

use std::collections::HashMap;

use crate::diagnostic::{err, DResult, DeonError, Diagnostic, DiagnosticCode, Span};
use crate::options::ParseOptions;
use crate::scanner::{parse_reference, ESCAPED_INTERPOLATION};
use crate::syntax::{
    Access, CallArgument, Declaration, Document, Leaflink, ListItem, MapItem, Reference, ValueNode,
};
use crate::text::interpolations;
use crate::value::{Map, Value};

/// The arguments of an entity call, bound for the length of that call and shadowing the leaflinks
/// around it.
pub type Locals = HashMap<String, String>;

/// The declarations are borrowed out of the document at `'a`, which is what lets the evaluator hold
/// `&mut self` and a node of the tree at the same time: a `&'a Leaflink` copied out of the map does
/// not borrow `self`, so the two never collide.
pub struct Evaluator<'a> {
    document: &'a Document,
    declarations: HashMap<&'a str, &'a Leaflink>,
    options: &'a ParseOptions,
    cache: HashMap<String, Value>,
    resolving: Vec<String>,
    calling: Vec<String>,
}

impl<'a> Evaluator<'a> {
    pub fn new(document: &'a Document, options: &'a ParseOptions) -> DResult<Self> {
        let mut declarations: HashMap<&'a str, &'a Leaflink> = HashMap::new();

        for declaration in &document.declarations {
            match declaration {
                Declaration::Resource(resource) => {
                    return err(
                        DiagnosticCode::ResourceIo,
                        format!("Resource '{}' was not materialized.", resource.name),
                        &resource.span,
                    );
                }
                Declaration::Leaflink(leaflink) => {
                    if let Some(first) = declarations.get(leaflink.name.as_str()) {
                        // The primary span stays on the repeat; a related span sends the reader
                        // back to the first declaration of the name (`spec/diagnostics.md`).
                        let diagnostic = Diagnostic::new(
                            DiagnosticCode::DuplicateDeclaration,
                            format!("Declaration '{}' is defined more than once.", leaflink.name),
                            leaflink.span.clone(),
                        )
                        .with_related(vec![first.span.clone()]);

                        return Err(DeonError::from_diagnostic(diagnostic));
                    }

                    declarations.insert(&leaflink.name, leaflink);
                }
            }
        }

        Ok(Self {
            document,
            declarations,
            options,
            cache: HashMap::new(),
            resolving: Vec::new(),
            calling: Vec::new(),
        })
    }

    pub fn evaluate(&mut self) -> DResult<Value> {
        let root: &'a ValueNode = &self.document.root;

        self.value(root, &Locals::new())
    }

    pub fn evaluate_node(&mut self, node: &'a ValueNode) -> DResult<Value> {
        self.value(node, &Locals::new())
    }

    /// Every declaration, evaluated. Editors read this to offer completions, so a leaflink that
    /// cannot stand on its own, through a cycle or a broken link, is left out rather than failing
    /// the whole lookup.
    pub fn leaflinks(&mut self) -> Map {
        let names: Vec<&'a str> = self
            .document
            .declarations
            .iter()
            .filter_map(|declaration| match declaration {
                Declaration::Leaflink(leaflink) => Some(leaflink.name.as_str()),
                Declaration::Resource(_) => None,
            })
            .collect();

        let mut result = Map::new();

        for name in names {
            let span = self.declarations[name].span.clone();

            if let Ok(value) = self.resolve_name(name, &span) {
                result.insert(name, value);
            }
        }

        result
    }

    fn value(&mut self, node: &'a ValueNode, locals: &Locals) -> DResult<Value> {
        match node {
            ValueNode::Scalar { value, span } => self.interpolate(value, span, locals),
            ValueNode::Link { reference, span } => self.reference(reference, span, locals),
            ValueNode::Call {
                reference,
                arguments,
                span,
            } => self.call(reference, arguments, span, locals),
            ValueNode::Map { entries, .. } => self.map(entries, locals),
            ValueNode::List { items, .. } => self.list(items, locals),
            ValueNode::Structure { fields, rows, span } => {
                self.structure(fields, rows, span, locals)
            }
        }
    }

    fn list(&mut self, items: &'a [ListItem], locals: &Locals) -> DResult<Value> {
        let mut result: Vec<Value> = Vec::new();

        for item in items {
            match item {
                ListItem::Value(node) => result.push(self.value(node, locals)?),
                ListItem::Spread { reference, span } => {
                    match self.reference(reference, span, locals)? {
                        // A string spreads into a list as its code points.
                        Value::String(spread) => result.extend(
                            spread.chars().map(|character| Value::string(character.to_string())),
                        ),
                        Value::List(spread) => result.extend(spread),
                        Value::Map(_) => {
                            return err(
                                DiagnosticCode::TypeMismatch,
                                "A list can spread only a list or string.",
                                span,
                            );
                        }
                    }
                }
            }
        }

        Ok(Value::List(result))
    }

    fn map(&mut self, entries: &'a [MapItem], locals: &Locals) -> DResult<Value> {
        let mut result = Map::new();

        for entry in entries {
            match entry {
                MapItem::Entry { name, value, .. } => {
                    let value = self.value(value, locals)?;
                    result.insert(name.clone(), value);
                }

                // The shortened form takes its receiving key from the last segment of the link.
                MapItem::Link { value, .. } => {
                    let key = match value {
                        ValueNode::Link { reference, .. } | ValueNode::Call { reference, .. } => {
                            reference.receiving_key().to_string()
                        }
                        _ => String::new(),
                    };

                    let value = self.value(value, locals)?;
                    result.insert(key, value);
                }

                MapItem::Spread { reference, span } => {
                    match self.reference(reference, span, locals)? {
                        // A string spreads into a map under its decimal character indices.
                        Value::String(spread) => {
                            for (index, character) in spread.chars().enumerate() {
                                result.insert(index.to_string(), Value::string(character.to_string()));
                            }
                        }
                        Value::Map(spread) => {
                            for (key, value) in spread.iter() {
                                result.insert(key.clone(), value.clone());
                            }
                        }
                        Value::List(_) => {
                            return err(
                                DiagnosticCode::TypeMismatch,
                                "A map can spread only a map or string.",
                                span,
                            );
                        }
                    }
                }
            }
        }

        Ok(Value::Map(result))
    }

    /// A structure is a list of maps written as a table, so every row must carry exactly as many
    /// cells as the signature has fields.
    fn structure(
        &mut self,
        fields: &'a [String],
        rows: &'a [Vec<ValueNode>],
        span: &Span,
        locals: &Locals,
    ) -> DResult<Value> {
        for (index, field) in fields.iter().enumerate() {
            if fields[..index].contains(field) {
                return err(
                    DiagnosticCode::StructureArity,
                    format!("Structure field '{field}' is repeated."),
                    span,
                );
            }
        }

        let mut result: Vec<Value> = Vec::new();

        for row in rows {
            if row.len() != fields.len() {
                return err(
                    DiagnosticCode::StructureArity,
                    format!(
                        "Structure row has {} cells; expected {}.",
                        row.len(),
                        fields.len(),
                    ),
                    span,
                );
            }

            let mut entry = Map::new();

            for (field, cell) in fields.iter().zip(row) {
                let value = self.value(cell, locals)?;
                entry.insert(field.clone(), value);
            }

            result.push(Value::Map(entry));
        }

        Ok(Value::List(result))
    }

    /// A declaration is evaluated once and remembered, and a declaration that is already being
    /// evaluated is a cycle.
    fn resolve_name(&mut self, name: &str, span: &Span) -> DResult<Value> {
        if let Some(cached) = self.cache.get(name) {
            return Ok(cached.clone());
        }

        // Copied out of the map, so it borrows the document at `'a` rather than borrowing `self`.
        let Some(declaration) = self.declarations.get(name).copied() else {
            return err(
                DiagnosticCode::UnresolvedLink,
                format!("Unknown leaflink '{name}'."),
                span,
            );
        };

        if self.resolving.iter().any(|entry| entry == name) {
            let mut path = self.resolving.clone();
            path.push(name.to_string());

            return err(
                DiagnosticCode::Cycle,
                format!("Leaflink cycle: {}.", path.join(" -> ")),
                span,
            );
        }

        self.resolving.push(name.to_string());

        // Deliberately not `?`: the stack must be popped whether the value came back or not, which
        // is the `finally` of the reference implementation. `leaflinks` swallows failures, so a
        // leaked entry here would poison the next declaration it looked at.
        let result = self.value(&declaration.value, &Locals::new());

        self.resolving.pop();

        let value = result?;
        self.cache.insert(name.to_string(), value.clone());

        Ok(value)
    }

    /// Reads a link: a local, an environment name, or a leaflink, followed by the segments that
    /// navigate into it.
    fn reference(
        &mut self,
        reference: &Reference,
        span: &Span,
        locals: &Locals,
    ) -> DResult<Value> {
        let name = &reference.head;

        if name.is_empty() {
            return err(DiagnosticCode::UnresolvedLink, "A link requires a name.", span);
        }

        let mut value = if let Some(variable) = name.strip_prefix('$') {
            // An absent environment name is the empty string, never an error. Only the environment
            // supplied to the parse is read; the host process environment is never consulted, so a
            // document cannot reach out and read a host secret (specification 6).
            Value::String(self.options.environment.get(variable).cloned().unwrap_or_default())
        } else if let Some(local) = locals.get(name.as_str()) {
            Value::string(local.clone())
        } else {
            self.resolve_name(name, span)?
        };

        for segment in &reference.access {
            value = match value {
                Value::List(items) => {
                    // A dot segment or a quoted bracket names a key, which no list holds; only an
                    // in-range decimal index reads a position (specification 6).
                    let index = match segment {
                        Access::Index { index: Some(index), .. } => Some(*index),
                        _ => None,
                    };

                    match index.and_then(|index| items.into_iter().nth(index)) {
                        Some(item) => item,
                        None => {
                            return err(
                                DiagnosticCode::UnresolvedLink,
                                format!("Invalid list access '[{}]'.", segment.text()),
                                span,
                            );
                        }
                    }
                }
                Value::Map(entries) => match entries.get(segment.text()) {
                    Some(entry) => entry.clone(),
                    None => {
                        return err(
                            DiagnosticCode::UnresolvedLink,
                            format!("Missing access segment '{}'.", segment.text()),
                            span,
                        );
                    }
                },
                Value::String(_) => {
                    return err(
                        DiagnosticCode::UnresolvedLink,
                        format!("Missing access segment '{}'.", segment.text()),
                        span,
                    );
                }
            };
        }

        Ok(value)
    }

    /// Every `#{reference}` is replaced. The sentinel left behind by an escaped opener is turned
    /// back into text last, so that what it stands for is never itself resolved.
    fn interpolate(&mut self, input: &str, span: &Span, locals: &Locals) -> DResult<Value> {
        let found = interpolations(input);

        if found.is_empty() {
            return Ok(Value::string(input.replace(ESCAPED_INTERPOLATION, "#{")));
        }

        let mut output = String::with_capacity(input.len());
        let mut read = 0;

        for (start, end, raw) in found {
            output.push_str(&input[read..start]);

            let value = self.reference(&parse_reference(raw.trim()), span, locals)?;

            let Value::String(value) = value else {
                return err(
                    DiagnosticCode::TypeMismatch,
                    "Interpolation requires a string value.",
                    span,
                );
            };

            output.push_str(&value);
            read = end;
        }

        output.push_str(&input[read..]);

        Ok(Value::string(output.replace(ESCAPED_INTERPOLATION, "#{")))
    }

    /// Calls an entity. The interpolation names it carries are its exact parameter set, so an
    /// argument that is missing, extra, repeated, or not a string is an error.
    fn call(
        &mut self,
        reference: &'a Reference,
        arguments: &'a [CallArgument],
        span: &Span,
        outer: &Locals,
    ) -> DResult<Value> {
        let head = reference.head.as_str();

        let Some(declaration) = self.declarations.get(head).copied() else {
            return err(
                DiagnosticCode::UnresolvedLink,
                format!("Unknown entity '{head}'."),
                span,
            );
        };

        let target = Self::static_target(&declaration.value, &reference.access, span)?;
        let parameters = Self::parameters(target);

        let mut locals = Locals::new();

        for argument in arguments {
            if locals.contains_key(&argument.name) {
                // The argument list opens the fault; a related span points at the repeat itself
                // (specification 11.2).
                let diagnostic = Diagnostic::new(
                    DiagnosticCode::EntityArgument,
                    format!("Entity argument '{}' is repeated.", argument.name),
                    span.clone(),
                )
                .with_related(vec![argument.span.clone()]);

                return Err(DeonError::from_diagnostic(diagnostic));
            }

            let value = self.value(&argument.value, outer)?;

            let Value::String(value) = value else {
                // The argument list opens the fault; a related span points at the non-string
                // argument (specification 11.2).
                let diagnostic = Diagnostic::new(
                    DiagnosticCode::EntityArgument,
                    format!("Entity argument '{}' must be a string.", argument.name),
                    span.clone(),
                )
                .with_related(vec![argument.span.clone()]);

                return Err(DeonError::from_diagnostic(diagnostic));
            };

            locals.insert(argument.name.clone(), value);
        }

        // Reported in the order they were written, so the message does not shuffle between runs.
        let missing: Vec<&str> = parameters
            .iter()
            .filter(|parameter| !locals.contains_key(*parameter))
            .map(String::as_str)
            .collect();

        let extra: Vec<&str> = arguments
            .iter()
            .map(|argument| argument.name.as_str())
            .filter(|name| !parameters.iter().any(|parameter| parameter == name))
            .collect();

        if !missing.is_empty() || !extra.is_empty() {
            // The argument list opens the fault; each extra argument earns a related span, while a
            // purely missing argument has nowhere else to point (specification 11.2).
            let related: Vec<Span> = arguments
                .iter()
                .filter(|argument| !parameters.iter().any(|parameter| parameter == &argument.name))
                .map(|argument| argument.span.clone())
                .collect();

            let diagnostic = Diagnostic::new(
                DiagnosticCode::EntityArgument,
                format!(
                    "Entity arguments do not match; missing [{}], extra [{}].",
                    missing.join(", "),
                    extra.join(", "),
                ),
                span.clone(),
            )
            .with_related(related);

            return Err(DeonError::from_diagnostic(diagnostic));
        }

        let name = reference.identity();

        if self.calling.contains(&name) {
            return err(
                DiagnosticCode::Cycle,
                format!("Recursive entity call '{name}'."),
                span,
            );
        }

        self.calling.push(name);

        // As in `resolve_name`: bind, pop, and only then unwrap.
        let result = self.value(target, &locals);

        self.calling.pop();

        result
    }

    /// Navigates into the syntax of a called entity, rather than into its value, because the value
    /// cannot be evaluated before the arguments are known.
    fn static_target(
        node: &'a ValueNode,
        access: &[Access],
        span: &Span,
    ) -> DResult<&'a ValueNode> {
        let mut target = node;

        for segment in access {
            match target {
                ValueNode::Map { entries, .. } => {
                    // The last write to the key is the one that holds.
                    let found = entries.iter().rev().find_map(|entry| match entry {
                        MapItem::Entry { name, value, .. } if name == segment.text() => Some(value),
                        _ => None,
                    });

                    let Some(found) = found else {
                        return err(
                            DiagnosticCode::UnresolvedLink,
                            format!("Missing entity access segment '{}'.", segment.text()),
                            span,
                        );
                    };

                    target = found;
                }

                ValueNode::List { items, .. } => {
                    // Only an in-range decimal index reads a list position; a key does not.
                    let found = match segment {
                        Access::Index { index: Some(index), .. } => match items.get(*index) {
                            Some(ListItem::Value(value)) => Some(value),
                            _ => None,
                        },
                        _ => None,
                    };

                    let Some(found) = found else {
                        return err(
                            DiagnosticCode::UnresolvedLink,
                            format!("Invalid entity list access '[{}]'.", segment.text()),
                            span,
                        );
                    };

                    target = found;
                }

                _ => {
                    return err(
                        DiagnosticCode::UnresolvedLink,
                        format!("Cannot access entity segment '{}'.", segment.text()),
                        span,
                    );
                }
            }
        }

        Ok(target)
    }

    /// The parameters of an entity are the interpolation names written inside it. An environment
    /// name is read from the environment rather than passed in, so it is not one of them.
    pub fn parameters(node: &ValueNode) -> Vec<String> {
        let mut parameters: Vec<String> = Vec::new();

        Self::visit_parameters(node, &mut parameters);

        parameters
    }

    fn visit_parameters(node: &ValueNode, parameters: &mut Vec<String>) {
        match node {
            ValueNode::Scalar { value, .. } => {
                for (_, _, raw) in interpolations(value) {
                    let name = parse_reference(raw.trim()).head;

                    if name.is_empty() || name.starts_with('$') {
                        continue;
                    }

                    if !parameters.contains(&name) {
                        parameters.push(name);
                    }
                }
            }
            ValueNode::Map { entries, .. } => {
                for entry in entries {
                    match entry {
                        MapItem::Entry { value, .. } => Self::visit_parameters(value, parameters),
                        MapItem::Link {
                            value: ValueNode::Call { arguments, .. },
                            ..
                        } => {
                            for argument in arguments {
                                Self::visit_parameters(&argument.value, parameters);
                            }
                        }
                        _ => {}
                    }
                }
            }
            ValueNode::List { items, .. } => {
                for item in items {
                    if let ListItem::Value(value) = item {
                        Self::visit_parameters(value, parameters);
                    }
                }
            }
            ValueNode::Structure { rows, .. } => {
                for row in rows {
                    for cell in row {
                        Self::visit_parameters(cell, parameters);
                    }
                }
            }
            ValueNode::Call { arguments, .. } => {
                for argument in arguments {
                    Self::visit_parameters(&argument.value, parameters);
                }
            }
            ValueNode::Link { .. } => {}
        }
    }
}
