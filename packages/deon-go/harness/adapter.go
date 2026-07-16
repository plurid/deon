// The cross-implementation harness adapter (spec/harness/README.md).
//
// A filter: newline-delimited JSON in, newline-delimited JSON out. Nothing escapes it but a response
// — a host panic crossing this boundary would be reported as a disagreement, and it would be one.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"

	"deon"
)

type request struct {
	ID               string            `json:"id"`
	Op               string            `json:"op"`
	Source           string            `json:"source"`
	SourceName       string            `json:"sourceName"`
	Filebase         string            `json:"filebase"`
	Files            map[string]string `json:"files"`
	AbsolutePaths    map[string]string `json:"absolutePaths"`
	Environment      map[string]string `json:"environment"`
	AllowFilesystem  string            `json:"allowFilesystem"`
	AllowNetwork     string            `json:"allowNetwork"`
	DatasignFiles    []string          `json:"datasignFiles"`
	DatasignMap      map[string]string `json:"datasignMap"`
	StringifyOptions map[string]string `json:"stringifyOptions"`
}

func optionsOf(r request) deon.ParseOptions {
	sourceName := r.SourceName
	if sourceName == "" {
		sourceName = "<memory>"
	}
	return deon.ParseOptions{
		SourceName:      sourceName,
		Filebase:        r.Filebase,
		Resources:       r.Files,
		AbsolutePaths:   r.AbsolutePaths,
		Environment:     r.Environment,
		AllowFilesystem: r.AllowFilesystem == "true",
		AllowNetwork:    r.AllowNetwork == "true",
		DatasignFiles:   r.DatasignFiles,
		DatasignMap:     r.DatasignMap,
	}
}

func stringifyOptionsOf(given map[string]string) deon.StringifyOptions {
	options := deon.DefaultStringifyOptions()
	truthy := func(key string, fallback bool) bool {
		if v, ok := given[key]; ok {
			return v == "true"
		}
		return fallback
	}
	number := func(key string, fallback int) int {
		if v, ok := given[key]; ok {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		return fallback
	}
	options.Canonical = truthy("canonical", false)
	options.Readable = truthy("readable", true)
	options.Indentation = number("indentation", 4)
	options.Leaflinks = truthy("leaflinks", false)
	options.LeaflinkLevel = number("leaflinkLevel", 1)
	options.LeaflinkShortening = truthy("leaflinkShortening", true)
	options.GeneratedHeader = truthy("generatedHeader", false)
	options.GeneratedComments = truthy("generatedComments", false)
	return options
}

func perform(r request) (string, error) {
	options := optionsOf(r)

	switch r.Op {
	case "entities":
		found, err := deon.Entities(r.Source, options.SourceName)
		if err != nil {
			return "", err
		}
		shaped := make([]any, len(found))
		for i, entity := range found {
			shaped[i] = object{
				{"name", entity.Name},
				{"parameters", entity.Parameters},
				{"kind", entity.Kind},
			}
		}
		return marshal(shaped), nil
	case "lint":
		shaped := []any{}
		for _, d := range deon.Lint(r.Source, options.SourceName) {
			shaped = append(shaped, object{
				{"code", string(d.Code)},
				{"line", strconv.Itoa(d.Span.Line)},
				{"column", strconv.Itoa(d.Span.Column)},
			})
		}
		return marshal(shaped), nil
	}

	value, err := deon.ParseWith(r.Source, options)
	if err != nil {
		return "", err
	}

	switch r.Op {
	case "canonical":
		return deon.Canonical(value)
	case "stringify":
		return deon.Stringify(value, stringifyOptionsOf(r.StringifyOptions))
	case "typed":
		typedValue, err := deon.Typed(value)
		if err != nil {
			return "", err
		}
		return marshal(typedValue), nil
	case "datasign":
		// ParseWith has already applied the contracts, as the reference implementation does.
		return marshal(value), nil
	default:
		return "", fmt.Errorf("unknown operation '%s'", r.Op)
	}
}

// marshal serialises a result as JSON. The harness parses these `typed`, `lint`, `entities`, and
// `datasign` results back into structures and compares those, so the whitespace is its own business —
// but a Deon map's write order is preserved anyway, and Go's own encoder cannot see a *deon.Map's
// unexported fields, so the encoding is done by hand.
func marshal(value any) string {
	var b []byte
	b = appendJSON(b, value)
	return string(b)
}

// object is a JSON object with a fixed field order, so the harness — which compares parsed structures
// by their reproduced insertion order — sees the same shape from every implementation.
type object []field

type field struct {
	key   string
	value any
}

func appendJSON(b []byte, value any) []byte {
	switch v := value.(type) {
	case nil:
		return append(b, "null"...)
	case object:
		b = append(b, '{')
		for i, f := range v {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendJSONString(b, f.key)
			b = append(b, ':')
			b = appendJSON(b, f.value)
		}
		return append(b, '}')
	case string:
		return appendJSONString(b, v)
	case bool:
		if v {
			return append(b, "true"...)
		}
		return append(b, "false"...)
	case float64:
		return strconv.AppendFloat(b, v, 'g', -1, 64)
	case int:
		return strconv.AppendInt(b, int64(v), 10)
	case []deon.Value:
		items := make([]any, len(v))
		for i := range v {
			items[i] = v[i]
		}
		return appendJSONArray(b, items)
	case []any:
		return appendJSONArray(b, v)
	case []string:
		items := make([]any, len(v))
		for i := range v {
			items[i] = v[i]
		}
		return appendJSONArray(b, items)
	case []map[string]any:
		items := make([]any, len(v))
		for i := range v {
			items[i] = v[i]
		}
		return appendJSONArray(b, items)
	case []map[string]string:
		items := make([]any, len(v))
		for i := range v {
			items[i] = v[i]
		}
		return appendJSONArray(b, items)
	case *deon.Map:
		b = append(b, '{')
		for i, key := range v.Keys() {
			if i > 0 {
				b = append(b, ',')
			}
			member, _ := v.Get(key)
			b = appendJSONString(b, key)
			b = append(b, ':')
			b = appendJSON(b, member)
		}
		return append(b, '}')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b = append(b, '{')
		for i, key := range keys {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendJSONString(b, key)
			b = append(b, ':')
			b = appendJSON(b, v[key])
		}
		return append(b, '}')
	case map[string]string:
		generic := make(map[string]any, len(v))
		for k, item := range v {
			generic[k] = item
		}
		return appendJSON(b, generic)
	default:
		return append(b, "null"...)
	}
}

func appendJSONArray(b []byte, items []any) []byte {
	b = append(b, '[')
	for i, item := range items {
		if i > 0 {
			b = append(b, ',')
		}
		b = appendJSON(b, item)
	}
	return append(b, ']')
}

func appendJSONString(b []byte, s string) []byte {
	quoted, _ := json.Marshal(s)
	return append(b, quoted...)
}

func main() {
	reader := bufio.NewScanner(os.Stdin)
	reader.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()

	for reader.Scan() {
		line := reader.Bytes()
		if len(line) == 0 {
			continue
		}
		var r request
		if err := json.Unmarshal(line, &r); err != nil {
			continue
		}

		answer := answerFor(r)
		out, _ := json.Marshal(answer)
		writer.Write(out)
		writer.WriteByte('\n')
		writer.Flush()
	}
}

func answerFor(r request) map[string]any {
	result, err := performSafely(r)
	if err != nil {
		if deonErr, ok := err.(*deon.Error); ok {
			diag := deonErr.Diagnostics[0]
			span := diag.Span
			// A diagnostic's related spans are part of the contract too (spec/diagnostics.md): each is
			// reported as its own start/line/column triple, in order. None reported is an empty list,
			// not null, so the slice is initialised non-nil.
			related := [][]string{}
			for _, s := range diag.Related {
				related = append(related, []string{
					strconv.Itoa(s.Start),
					strconv.Itoa(s.Line),
					strconv.Itoa(s.Column),
				})
			}
			return map[string]any{
				"id":       r.ID,
				"ok":       "false",
				"code":     string(deonErr.Code),
				"severity": diag.Severity,
				"start":    strconv.Itoa(span.Start),
				"line":     strconv.Itoa(span.Line),
				"column":   strconv.Itoa(span.Column),
				"related":  related,
			}
		}
		// The host leaking through is a disagreement, and it says so.
		return map[string]any{
			"id":     r.ID,
			"ok":     "false",
			"code":   "HOST_PANIC",
			"line":   "0",
			"column": "0",
		}
	}
	return map[string]any{"id": r.ID, "ok": "true", "result": result}
}

// performSafely turns a stray panic into an error, so a bug here is reported rather than killing the
// process mid-stream and losing every answer after it.
func performSafely(r request) (result string, err error) {
	defer func() {
		if raised := recover(); raised != nil {
			if deonErr, ok := raised.(*deon.Error); ok {
				err = deonErr
				return
			}
			err = fmt.Errorf("panic: %v", raised)
		}
	}()
	return perform(r)
}
