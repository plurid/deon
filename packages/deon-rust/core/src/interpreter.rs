//! Loads every resource and puts its value back into the tree, so that the evaluation that follows
//! sees only leaflinks.

use std::collections::HashMap;

use crate::diagnostic::{err, DResult, DiagnosticCode, Span};
use crate::evaluator::Evaluator;
use crate::json::parse_json;
use crate::options::ParseOptions;
use crate::parser::Parser;
use crate::resources::{
    authorization, extension, resolve_mapped_absolute_path, resource_target, Fetched,
    ResourceLoader,
};
use crate::scanner::{parse_reference, Scanner};
use crate::syntax::{
    Declaration, Document, Leaflink, ListItem, MapItem, Reference, Resource, ResourceKind, ValueNode,
};
use crate::text::{interpolations, is_url};
use crate::value::{Map, Value};

/// A loaded resource re-enters the tree as an ordinary value, so that whatever links to it cannot
/// tell it came from somewhere else.
fn node_from_value(value: Value, span: &Span) -> ValueNode {
    match value {
        Value::String(value) => ValueNode::Scalar {
            value,
            span: span.clone(),
        },
        Value::List(items) => ValueNode::List {
            items: items
                .into_iter()
                .map(|item| ListItem::Value(node_from_value(item, span)))
                .collect(),
            span: span.clone(),
        },
        Value::Map(entries) => ValueNode::Map {
            entries: entries
                .iter()
                .map(|(name, value)| MapItem::Entry {
                    name: name.clone(),
                    value: node_from_value(value.clone(), span),
                    span: span.clone(),
                })
                .collect(),
            span: span.clone(),
        },
    }
}

/// Imports, injections, and leaflinks share one namespace, so a name may be declared only once
/// (specification 3).
fn validate_declarations(document: &Document) -> DResult<()> {
    let mut names: Vec<&str> = Vec::new();

    for declaration in &document.declarations {
        let name = declaration.name();

        if names.contains(&name) {
            return err(
                DiagnosticCode::DuplicateDeclaration,
                format!("Declaration '{name}' is defined more than once."),
                declaration.span(),
            );
        }

        names.push(name);
    }

    Ok(())
}

pub struct Interpreter<'a> {
    loader: &'a dyn ResourceLoader,
}

impl<'a> Interpreter<'a> {
    pub fn new(loader: &'a dyn ResourceLoader) -> Self {
        Self { loader }
    }

    pub fn interpret(&self, document: &Document, options: &ParseOptions) -> DResult<Value> {
        let materialized = self.materialize(document, options)?;

        Evaluator::new(&materialized, options)?.evaluate()
    }

    /// The evaluated declaration namespace. Editor tooling reads this to drive leaflink completion.
    pub fn leaflinks(&self, document: &Document, options: &ParseOptions) -> DResult<Map> {
        let materialized = self.materialize(document, options)?;

        Ok(Evaluator::new(&materialized, options)?.leaflinks())
    }

    /// A resource whose authenticator depends on another resource is loaded after it.
    fn materialize(&self, document: &Document, options: &ParseOptions) -> DResult<Document> {
        validate_declarations(document)?;

        let resources: Vec<&Resource> = document
            .declarations
            .iter()
            .filter_map(|declaration| match declaration {
                Declaration::Resource(resource) => Some(resource),
                Declaration::Leaflink(_) => None,
            })
            .collect();

        let mut replacements: HashMap<String, Leaflink> = HashMap::new();
        let mut resolving: Vec<String> = Vec::new();

        for resource in &resources {
            self.resolve(
                resource,
                document,
                &resources,
                options,
                &mut replacements,
                &mut resolving,
            )?;
        }

        Ok(Document {
            declarations: document
                .declarations
                .iter()
                .map(|declaration| match declaration {
                    Declaration::Leaflink(leaflink) => Declaration::Leaflink(leaflink.clone()),
                    Declaration::Resource(resource) => {
                        Declaration::Leaflink(replacements[&resource.name].clone())
                    }
                })
                .collect(),
            root: document.root.clone(),
            source: document.source.clone(),
        })
    }

    fn resolve(
        &self,
        resource: &Resource,
        document: &Document,
        resources: &[&Resource],
        options: &ParseOptions,
        replacements: &mut HashMap<String, Leaflink>,
        resolving: &mut Vec<String>,
    ) -> DResult<()> {
        if replacements.contains_key(&resource.name) {
            return Ok(());
        }

        if resolving.contains(&resource.name) {
            let mut path = resolving.clone();
            path.push(resource.name.clone());

            return err(
                DiagnosticCode::Cycle,
                format!("Resource dependency cycle: {}.", path.join(" -> ")),
                &resource.span,
            );
        }

        resolving.push(resource.name.clone());

        // Bound, not `?`-ed: the stack is popped whether or not the resource came back.
        let result = (|| {
            for name in self.resource_dependencies(resource, document, resources) {
                let Some(dependency) = resources.iter().find(|entry| entry.name == name) else {
                    continue;
                };

                self.resolve(
                    dependency,
                    document,
                    resources,
                    options,
                    replacements,
                    resolving,
                )?;
            }

            let authenticator = self.authenticator(resource, document, replacements, options)?;
            let loaded = self.load(resource, options, authenticator.as_deref())?;

            Ok(Leaflink {
                name: resource.name.clone(),
                value: node_from_value(loaded, &resource.span),
                span: resource.span.clone(),
            })
        })();

        resolving.pop();

        replacements.insert(resource.name.clone(), result?);

        Ok(())
    }

    /// The resources an authenticator reaches for, directly or through the leaflinks it reads.
    fn resource_dependencies(
        &self,
        resource: &Resource,
        document: &Document,
        resources: &[&Resource],
    ) -> Vec<String> {
        let Some(authenticator) = &resource.authenticator else {
            return Vec::new();
        };

        let mut dependencies: Vec<String> = Vec::new();
        let mut visited: Vec<String> = Vec::new();

        self.visit_dependencies(
            authenticator,
            document,
            resources,
            &mut dependencies,
            &mut visited,
        );

        dependencies
    }

    fn visit_dependencies(
        &self,
        node: &ValueNode,
        document: &Document,
        resources: &[&Resource],
        dependencies: &mut Vec<String>,
        visited: &mut Vec<String>,
    ) {
        let follow = |reference: &Reference,
                          dependencies: &mut Vec<String>,
                          visited: &mut Vec<String>,
                          interpreter: &Self| {
            let name = &reference.head;

            if name.is_empty() || name.starts_with('$') {
                return;
            }

            if resources.iter().any(|entry| entry.name == *name) {
                if !dependencies.contains(name) {
                    dependencies.push(name.clone());
                }

                return;
            }

            if visited.contains(name) {
                return;
            }

            let leaflink = document.declarations.iter().find_map(|declaration| {
                match declaration {
                    Declaration::Leaflink(leaflink) if leaflink.name == *name => Some(leaflink),
                    _ => None,
                }
            });

            let Some(leaflink) = leaflink else {
                return;
            };

            visited.push(name.clone());

            interpreter.visit_dependencies(
                &leaflink.value,
                document,
                resources,
                dependencies,
                visited,
            );
        };

        match node {
            ValueNode::Scalar { value, .. } => {
                for (_, _, raw) in interpolations(value) {
                    follow(&parse_reference(raw.trim()), dependencies, visited, self);
                }
            }
            ValueNode::Link { reference, .. } => {
                follow(reference, dependencies, visited, self);
            }
            ValueNode::Call {
                reference,
                arguments,
                ..
            } => {
                follow(reference, dependencies, visited, self);

                for argument in arguments {
                    self.visit_dependencies(
                        &argument.value,
                        document,
                        resources,
                        dependencies,
                        visited,
                    );
                }
            }
            ValueNode::Map { entries, .. } => {
                for entry in entries {
                    match entry {
                        MapItem::Entry { value, .. } => self.visit_dependencies(
                            value,
                            document,
                            resources,
                            dependencies,
                            visited,
                        ),
                        MapItem::Spread { reference, .. } => {
                            follow(reference, dependencies, visited, self);
                        }
                        MapItem::Link { value, .. } => self.visit_dependencies(
                            value,
                            document,
                            resources,
                            dependencies,
                            visited,
                        ),
                    }
                }
            }
            ValueNode::List { items, .. } => {
                for item in items {
                    match item {
                        ListItem::Value(value) => self.visit_dependencies(
                            value,
                            document,
                            resources,
                            dependencies,
                            visited,
                        ),
                        ListItem::Spread { reference, .. } => {
                            follow(reference, dependencies, visited, self);
                        }
                    }
                }
            }
            ValueNode::Structure { rows, .. } => {
                for row in rows {
                    for cell in row {
                        self.visit_dependencies(
                            cell,
                            document,
                            resources,
                            dependencies,
                            visited,
                        );
                    }
                }
            }
        }
    }

    /// Evaluates the `with` of a resource against the leaflinks, and the resources already loaded.
    fn authenticator(
        &self,
        resource: &Resource,
        document: &Document,
        replacements: &HashMap<String, Leaflink>,
        options: &ParseOptions,
    ) -> DResult<Option<String>> {
        let Some(authenticator) = &resource.authenticator else {
            return Ok(None);
        };

        let available: Vec<Declaration> = document
            .declarations
            .iter()
            .filter_map(|declaration| match declaration {
                Declaration::Leaflink(leaflink) => Some(Declaration::Leaflink(leaflink.clone())),
                Declaration::Resource(entry) => replacements
                    .get(&entry.name)
                    .map(|loaded| Declaration::Leaflink(loaded.clone())),
            })
            .collect();

        let scope = Document {
            declarations: available,
            root: document.root.clone(),
            source: document.source.clone(),
        };

        let value = Evaluator::new(&scope, options)?.evaluate_node(authenticator)?;

        match value {
            Value::String(value) => Ok(Some(value)),
            _ => err(
                DiagnosticCode::TypeMismatch,
                "A resource authenticator must resolve to a string.",
                &resource.span,
            ),
        }
    }

    fn load(
        &self,
        resource: &Resource,
        options: &ParseOptions,
        authenticator: Option<&str>,
    ) -> DResult<Value> {
        let target = resource_target(resource, options);

        // The `with` written on the declaration wins; the `authorization` map is the fallback. The
        // `token` option is not consulted here at all — that one belongs to `parse_link`.
        let host_token = authorization(&target, options);
        let token = authenticator.or(host_token.as_deref());

        let fetched = self
            .virtual_resource(resource, &target, options)
            .or_else(|| self.loader.load(&target, resource.kind, options, token));

        let Some(fetched) = fetched else {
            return self.unavailable(resource, options, &target);
        };

        // An injection keeps its target exactly, without parsing it.
        if resource.kind == ResourceKind::Inject {
            return Ok(Value::String(fetched.data));
        }

        if fetched.filetype == ".json" {
            return match parse_json(&fetched.data) {
                Ok(value) => Ok(value),
                Err(_) => err(
                    DiagnosticCode::ResourceFormat,
                    format!("Invalid JSON resource '{}'.", resource.target),
                    &resource.span,
                ),
            };
        }

        if fetched.filetype != ".deon" {
            return err(
                DiagnosticCode::ResourceFormat,
                format!("Unsupported import format '{}'.", fetched.filetype),
                &resource.span,
            );
        }

        self.import(resource, options, fetched)
    }

    /// A Deon resource is a document in its own right, so it is read the same way, with the stack it
    /// stands on carried in so that it cannot import itself.
    fn import(
        &self,
        resource: &Resource,
        options: &ParseOptions,
        fetched: Fetched,
    ) -> DResult<Value> {
        let id = fetched.resource_id;

        if options.resource_stack.contains(&id) {
            let mut path = options.resource_stack.clone();
            path.push(id);

            return err(
                DiagnosticCode::Cycle,
                format!("Resource cycle: {}.", path.join(" -> ")),
                &resource.span,
            );
        }

        let mut nested = options.clone();
        nested.source_name = id.clone();
        nested.filebase = fetched.filebase;
        nested.resource_stack.push(id.clone());

        // A fault inside the imported document is reported at the statement that imported it (§11.2):
        // the document a caller is holding is the importing one, and the line they can go and look at
        // is the import. A cycle keeps its own span — it is reported at the reference that closes it,
        // not at every statement it was reached through.
        Scanner::new(&fetched.data, &id)
            .scan()
            .and_then(|tokens| Parser::new(tokens, &id).parse())
            .and_then(|document| self.interpret(&document, &nested))
            .map_err(|mut failure| {
                if failure.code != DiagnosticCode::Cycle {
                    if let Some(first) = failure.diagnostics.first_mut() {
                        first.span = resource.span.clone();
                    }
                }
                failure
            })
    }

    /// A resource supplied through the `resources` option, which is how a test, or an editor, hands
    /// over a document without touching the filesystem or the network at all.
    fn virtual_resource(
        &self,
        resource: &Resource,
        target: &str,
        options: &ParseOptions,
    ) -> Option<Fetched> {
        let mapped = resolve_mapped_absolute_path(target, &options.absolute_paths);

        let data = options
            .resources
            .get(&mapped)
            .or_else(|| options.resources.get(target))
            .or_else(|| options.resources.get(&resource.target))?;

        Some(Fetched {
            data: data.clone(),
            filetype: extension(&mapped, resource.kind),
            filebase: crate::resources::directory_of(&mapped).to_string(),
            resource_id: mapped,
        })
    }

    /// A resource that could not be read was either denied or unreachable, and the two must not be
    /// confused: one is a decision, the other an accident.
    fn unavailable(
        &self,
        resource: &Resource,
        options: &ParseOptions,
        target: &str,
    ) -> DResult<Value> {
        let remote = is_url(target);

        let allowed = if remote {
            options.allow_network
        } else {
            options.allow_filesystem
        };

        // Which capability was refused is known right here, and saying so is the difference between a
        // reader who fixes it and one who goes looking. `DEON_CAPABILITY_DENIED` says a decision was
        // taken; only the message can say which.
        let capability = if remote { "network" } else { "filesystem" };

        err(
            if allowed {
                DiagnosticCode::ResourceIo
            } else {
                DiagnosticCode::CapabilityDenied
            },
            if allowed {
                format!("Unable to load resource '{}'.", resource.target)
            } else {
                format!(
                    "The resource '{}' was not permitted: {capability} access is not allowed.",
                    resource.target,
                )
            },
            &resource.span,
        )
    }
}
