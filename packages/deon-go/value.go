// Package deon implements the DeObject Notation Format (specification 1.0).
//
// A Deon value is exactly one of three things: a string, an ordered list, or an ordered map
// (specification 2). There is no null, no boolean, and no number — a host that has them must say what
// they become. In Go those three are modelled as, respectively, string, []Value, and *Map, and a
// Value is any one of them.
//
// This implementation was written from spec/SPECIFICATION.md, spec/deon.ebnf, and spec/diagnostics.md
// rather than from the sibling implementations, which is the point of a fourth reading: the reference
// is JavaScript, Rust was ported from it, and Python and this from the prose. Where the prose only
// determines behaviour because three implementations already agree, a fourth is the test of whether it
// determines it at all.
package deon

// Value is a Deon value: a string, a []Value, or a *Map, and nothing else.
type Value any

// Map is an ordered map from string keys to Deon values.
//
// It is not Go's built-in map, and the reason is one sentence of the specification: a map is built
// from top to bottom, and a later write to a key *replaces the value and moves the key to its final
// write position* (specification 5). A built-in map has no order at all, and even an order kept
// beside it would need this move rule written by hand — so the rule lives in the one method that
// mutates.
type Map struct {
	keys   []string
	values map[string]Value
}

// NewMap returns an empty ordered map.
func NewMap() *Map {
	return &Map{values: map[string]Value{}}
}

// Set writes a key, moving it to the end when it was already present.
//
//	{ a one, b two, a three }
//
// is { b: two, a: three } in Deon — the second write to a moves it past b — and a built-in map would
// leave a in its first slot. The move is invisible to a lookup and plain in a stringification, which
// is exactly the kind of difference that survives a test suite that only compares values.
func (m *Map) Set(key string, value Value) {
	if _, ok := m.values[key]; ok {
		for i, existing := range m.keys {
			if existing == key {
				m.keys = append(m.keys[:i], m.keys[i+1:]...)
				break
			}
		}
	}

	m.values[key] = value
	m.keys = append(m.keys, key)
}

// Get returns the value for a key, and whether it was present.
func (m *Map) Get(key string) (Value, bool) {
	value, ok := m.values[key]
	return value, ok
}

// Has reports whether a key is present.
func (m *Map) Has(key string) bool {
	_, ok := m.values[key]
	return ok
}

// Len returns the number of keys.
func (m *Map) Len() int {
	return len(m.keys)
}

// Keys returns the keys in write order. The slice is a copy, so a caller cannot disturb the order.
func (m *Map) Keys() []string {
	out := make([]string, len(m.keys))
	copy(out, m.keys)
	return out
}

// Equal reports whether two Deon values are equal.
//
// Maps are compared by key and value and *not* by order: map order is presentation rather than data
// (specification 2), and it is asserted through canonical form and stringification, which are the
// places it means something. Lists are compared positionally, because list order is semantic.
func Equal(a, b Value) bool {
	switch left := a.(type) {
	case string:
		right, ok := b.(string)
		return ok && left == right

	case []Value:
		right, ok := b.([]Value)
		if !ok || len(left) != len(right) {
			return false
		}
		for i := range left {
			if !Equal(left[i], right[i]) {
				return false
			}
		}
		return true

	case *Map:
		right, ok := b.(*Map)
		if !ok || left.Len() != right.Len() {
			return false
		}
		for _, key := range left.keys {
			other, present := right.values[key]
			if !present || !Equal(left.values[key], other) {
				return false
			}
		}
		return true

	default:
		return false
	}
}
