package deon

import (
	"math"
	"regexp"
	"strconv"
)

// The conservative typer (specification 14). Typing is outside the Deon data model, so this is a view
// of a value rather than a value: it converts only what it could write back out unchanged, and
// refuses whenever a guess could be wrong. 007 stays a string, because a postal code that becomes the
// number 7 is a bug; null stays "null", because Deon has no null; a number too large for a float stays
// a string, because a float would hand back a different number than the one written.

const safeInteger = 9007199254740991 // 2^53 - 1

var (
	integerForm = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)
	numberForm  = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)
)

func typed(value Value) any {
	guardTypedDepth(value)
	return typedNode(value)
}

// guardTypedDepth enforces the nesting limit on a value handed to the typer by a host, which never
// met the parser (specification 11.1). It walks iteratively before any recursive typing runs, so the
// limit is checked rather than discovered by a stack overflow.
func guardTypedDepth(value Value) {
	type frame struct {
		value Value
		depth int
	}
	stack := []frame{{value, 0}}
	for len(stack) > 0 {
		f := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if f.depth > maxDepth {
			fail(ParseExpected, "The value nests more deeply than the typer will follow.", headSpan("<value>"))
		}
		switch v := f.value.(type) {
		case []Value:
			for _, item := range v {
				stack = append(stack, frame{item, f.depth + 1})
			}
		case *Map:
			for _, key := range v.Keys() {
				member, _ := v.Get(key)
				stack = append(stack, frame{member, f.depth + 1})
			}
		}
	}
}

func typedNode(value Value) any {
	switch v := value.(type) {
	case string:
		return typeScalar(v)
	case []Value:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = typedNode(item)
		}
		return out
	case *Map:
		out := NewMap()
		for _, key := range v.Keys() {
			member, _ := v.Get(key)
			out.Set(key, typedNode(member))
		}
		return out
	default:
		return value
	}
}

func typeScalar(s string) any {
	switch s {
	case "true":
		return true
	case "false":
		return false
	}

	if integerForm.MatchString(s) {
		n, err := strconv.ParseInt(s, 10, 64)
		if err == nil && n >= -safeInteger && n <= safeInteger {
			return float64(n)
		}
		return s
	}

	if numberForm.MatchString(s) {
		n, err := strconv.ParseFloat(s, 64)
		if err == nil && !isInfOrNaN(n) {
			return n
		}
		return s
	}

	return s
}

func isInfOrNaN(f float64) bool {
	return math.IsNaN(f) || math.IsInf(f, 0)
}
