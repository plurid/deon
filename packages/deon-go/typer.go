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
	switch v := value.(type) {
	case string:
		return typeScalar(v)
	case []Value:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = typed(item)
		}
		return out
	case *Map:
		out := NewMap()
		for _, key := range v.Keys() {
			member, _ := v.Get(key)
			out.Set(key, typed(member))
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
