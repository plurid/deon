//! The Deon data model.

use std::collections::HashMap;

/// A Deon value is exactly one of three things: a string, an ordered list, or an ordered map. There
/// is no null, no boolean, and no number, so a host that has them must say what they become
/// (specification 2).
///
/// A spread copies values rather than aliasing them (specification 7), which here needs no help:
/// `Clone` is already a deep copy, so the `clone` the reference implementation had to write by hand
/// does not exist.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    String(String),
    List(Vec<Value>),
    Map(Map),
}

impl Value {
    pub fn string(value: impl Into<String>) -> Self {
        Value::String(value.into())
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn is_container(&self) -> bool {
        !matches!(self, Value::String(_))
    }
}

/// The point past which a linear scan costs more than a hash. Most maps written by hand hold a
/// handful of keys, and for those the scan wins outright; an imported JSON object may hold
/// thousands, and for those it does not.
const INDEX_THRESHOLD: usize = 16;

/// An insertion-ordered map.
///
/// A key written again is last-write-wins, and it *moves to the position of its final write*
/// (specification 5), which is why the entries are a vector: it is the only shape in which "move to
/// the end" is a natural operation rather than a rebuild.
///
/// The index exists only so that the lookup behind every leaflink access, every spread, and every
/// bracket segment does not turn a large imported object into a quadratic one. It is built lazily,
/// and both paths hide behind `position`, so nothing outside this file knows which one is in use.
#[derive(Clone, Debug, Default)]
pub struct Map {
    entries: Vec<(String, Value)>,
    index: Option<HashMap<String, usize>>,
}

impl Map {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn iter(&self) -> std::slice::Iter<'_, (String, Value)> {
        self.entries.iter()
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(key, _)| key.as_str())
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.position(key).map(|at| &self.entries[at].1)
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.position(key).is_some()
    }

    /// The only mutator, so the last-write-wins rule cannot be written around.
    pub fn insert(&mut self, key: impl Into<String>, value: Value) {
        let key = key.into();

        if let Some(at) = self.position(&key) {
            self.entries.remove(at);

            if self.index.is_some() {
                self.build_index();
            }
        }

        self.entries.push((key.clone(), value));

        match &mut self.index {
            Some(index) => {
                index.insert(key, self.entries.len() - 1);
            }
            None if self.entries.len() > INDEX_THRESHOLD => self.build_index(),
            None => {}
        }
    }

    fn position(&self, key: &str) -> Option<usize> {
        match &self.index {
            Some(index) => index.get(key).copied(),
            None => self.entries.iter().position(|(name, _)| name == key),
        }
    }

    fn build_index(&mut self) {
        self.index = Some(
            self.entries
                .iter()
                .enumerate()
                .map(|(at, (key, _))| (key.clone(), at))
                .collect(),
        );
    }
}

impl FromIterator<(String, Value)> for Map {
    fn from_iter<T: IntoIterator<Item = (String, Value)>>(entries: T) -> Self {
        let mut map = Map::new();

        for (key, value) in entries {
            map.insert(key, value);
        }

        map
    }
}

impl<'a> IntoIterator for &'a Map {
    type Item = &'a (String, Value);
    type IntoIter = std::slice::Iter<'a, (String, Value)>;

    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}

/// Order is presentation, not data (specification 2), so two maps holding the same keys are equal
/// however they are laid out. Order is asserted where it is meant: in canonical and stringified
/// output.
impl PartialEq for Map {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len()
            && self
                .entries
                .iter()
                .all(|(key, value)| other.get(key) == Some(value))
    }
}

impl Eq for Map {}
