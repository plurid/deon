package deon

import (
	"encoding/json"
	"strings"
)

// jsonToValue converts JSON to a Deon value (specification 9.1). The one rule that shapes everything
// is that a number keeps its *source token spelling*: 1.50 converts to the string "1.50" and not to
// "1.5". Go's encoding/json preserves that when the decoder is told to hand numbers back as
// json.Number, which is the literal text — so the standard library reader is enough, and no
// hand-written number parser is needed.
//
// A boolean becomes "true" or "false", null becomes the empty string, and a repeated object member
// follows Deon's last-write-wins map rule, which is why an ordered Map is built by hand from the token
// stream rather than decoding into a Go map that would lose both the order and the move.
func jsonToValue(data string, at Span) Value {
	decoder := json.NewDecoder(strings.NewReader(data))
	decoder.UseNumber()

	value, err := readJSONValue(decoder, at)
	if err != nil {
		fail(ResourceFormat, "The imported JSON is invalid: "+err.Error(), at)
	}

	// Trailing content after one JSON value is malformed input.
	if decoder.More() {
		fail(ResourceFormat, "The imported JSON has trailing content.", at)
	}

	return value
}

func readJSONValue(decoder *json.Decoder, at Span) (Value, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	return readJSONFrom(token, decoder, at)
}

func readJSONFrom(token json.Token, decoder *json.Decoder, at Span) (Value, error) {
	switch t := token.(type) {
	case json.Delim:
		switch t {
		case '{':
			return readJSONObject(decoder, at)
		case '[':
			return readJSONArray(decoder, at)
		default:
			fail(ResourceFormat, "The imported JSON is malformed.", at)
		}
	case string:
		return t, nil
	case json.Number:
		// The literal spelling, exactly as written.
		return t.String(), nil
	case bool:
		if t {
			return "true", nil
		}
		return "false", nil
	case nil:
		return "", nil
	}
	fail(ResourceFormat, "The imported JSON holds a value Deon cannot represent.", at)
	return nil, nil
}

func readJSONObject(decoder *json.Decoder, at Span) (Value, error) {
	result := NewMap()
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return nil, err
		}
		key, ok := keyToken.(string)
		if !ok {
			fail(ResourceFormat, "A JSON object key must be a string.", at)
		}
		value, err := readJSONValue(decoder, at)
		if err != nil {
			return nil, err
		}
		result.Set(key, value)
	}
	// Consume the closing '}'.
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	return result, nil
}

func readJSONArray(decoder *json.Decoder, at Span) (Value, error) {
	result := []Value{}
	for decoder.More() {
		value, err := readJSONValue(decoder, at)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	// Consume the closing ']'.
	if _, err := decoder.Token(); err != nil {
		return nil, err
	}
	return result, nil
}
