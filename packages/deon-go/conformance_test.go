package deon

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path"
	"sort"
	"strings"
	"testing"
)

// The normative conformance suite. An implementation conforms to Deon 1.0 only when it passes every
// required fixture in spec/conformance/cases.json (specification 15). The fixtures are language-neutral
// and shared by every implementation, so they are read from the repository rather than copied here,
// where they could drift away from it.

const manifestPath = "../../spec/conformance/cases.json"

// supportedFeatures are the optional parts of the language this implementation offers (specification
// 14.1 marks datasign optional). A fixture tagged with a feature runs only where the feature is
// supported and is filtered out elsewhere, so the coverage counters below balance over whatever ran.
var supportedFeatures = map[string]bool{"datasign": true}

type conformanceCase struct {
	ID          string                `json:"id"`
	Feature     string                `json:"feature"`
	Source      *string               `json:"source"`
	File        string                `json:"file"`
	Files       map[string]string     `json:"files"`
	Environment map[string]string     `json:"environment"`
	Options     map[string]any        `json:"options"`
	Expected    json.RawMessage       `json:"expected"`
	Error       string                `json:"error"`
	Position    *position             `json:"position"`
	Canonical   *string               `json:"canonical"`
	Stringify   *stringifyExpectation `json:"stringify"`
	Typed       json.RawMessage       `json:"typed"`
	Lint        []string              `json:"lint"`
	Datasign    *datasignExpectation  `json:"datasign"`
}

type position struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

type stringifyExpectation struct {
	Options  map[string]any `json:"options"`
	Expected string         `json:"expected"`
}

type datasignExpectation struct {
	Files []string          `json:"files"`
	Map   map[string]string `json:"map"`
	Typed json.RawMessage   `json:"typed"`
}

type checked struct {
	expected, errored, position, canonical, stringify, typed, lint, datasign int
}

func TestConformance(t *testing.T) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("reading the manifest: %v", err)
	}
	var manifest struct {
		Cases []conformanceCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("parsing the manifest: %v", err)
	}

	var cases []conformanceCase
	for _, c := range manifest.Cases {
		if c.Feature == "" || supportedFeatures[c.Feature] {
			cases = append(cases, c)
		}
	}
	if len(cases) == 0 {
		t.Fatal("the conformance manifest is empty")
	}

	var did checked
	for _, c := range cases {
		if err := runCase(c, &did); err != nil {
			t.Errorf("%s: %v", c.ID, err)
		}
	}

	if want := declaredCounts(cases); did != want {
		t.Errorf("the harness did not check everything the manifest declares\n  checked:  %+v\n  declared: %+v", did, want)
	}
}

func declaredCounts(cases []conformanceCase) checked {
	var d checked
	for _, c := range cases {
		if len(c.Expected) > 0 {
			d.expected++
		}
		if c.Error != "" {
			d.errored++
		}
		if c.Position != nil {
			d.position++
		}
		if c.Canonical != nil {
			d.canonical++
		}
		if c.Stringify != nil {
			d.stringify++
		}
		if len(c.Typed) > 0 {
			d.typed++
		}
		if c.Lint != nil {
			d.lint++
		}
		if c.Datasign != nil {
			d.datasign++
		}
	}
	return d
}

func sourceOf(c conformanceCase) string {
	if c.File != "" {
		return c.Files[c.File]
	}
	if c.Source != nil {
		return *c.Source
	}
	return ""
}

func optionsOf(c conformanceCase) ParseOptions {
	options := ParseOptions{}
	if c.Files != nil {
		options.Resources = c.Files
	}
	if c.File != "" {
		options.SourceName = c.File
		options.Filebase = path.Dir(c.File)
	}
	if c.Environment != nil {
		options.Environment = c.Environment
	}
	if c.Datasign != nil {
		options.DatasignFiles = c.Datasign.Files
		options.DatasignMap = c.Datasign.Map
	}
	for key, value := range c.Options {
		switch key {
		case "absolutePaths":
			options.AbsolutePaths = toStringMap(value)
		case "allowFilesystem":
			options.AllowFilesystem = value == true
		case "allowNetwork":
			options.AllowNetwork = value == true
		case "sourceName":
			options.SourceName, _ = value.(string)
		case "filebase":
			options.Filebase, _ = value.(string)
		}
	}
	return options
}

func toStringMap(value any) map[string]string {
	out := map[string]string{}
	if m, ok := value.(map[string]any); ok {
		for k, v := range m {
			out[k], _ = v.(string)
		}
	}
	return out
}

func runCase(c conformanceCase, did *checked) error {
	source := sourceOf(c)
	options := optionsOf(c)

	if c.Datasign != nil {
		return runDatasign(c, source, options, did)
	}

	if c.Error != "" {
		_, err := ParseWith(source, options)
		if err == nil {
			return fmt.Errorf("expected %s, but the document evaluated successfully", c.Error)
		}
		if err := matchError(c, err, did); err != nil {
			return err
		}
		return nil
	}

	asserted := false

	if len(c.Expected) > 0 {
		value, err := ParseWith(source, options)
		if err != nil {
			return fmt.Errorf("expected a value, got error %v", err)
		}
		if !valueMatches(value, c.Expected) {
			return fmt.Errorf("evaluated to %v, which does not match the expected", value)
		}
		did.expected++
		asserted = true
	}

	if c.Canonical != nil {
		got, err := CanonicalSource(source, options)
		if err != nil {
			return fmt.Errorf("canonical: %v", err)
		}
		if got != *c.Canonical {
			return fmt.Errorf("canonical: expected %q, got %q", *c.Canonical, got)
		}
		did.canonical++
		asserted = true
	}

	if c.Stringify != nil {
		value, err := ParseWith(source, options)
		if err != nil {
			return fmt.Errorf("stringify: %v", err)
		}
		got := Stringify(value, stringifyOptionsOf(c.Stringify.Options))
		if got != c.Stringify.Expected {
			return fmt.Errorf("stringify: expected %q, got %q", c.Stringify.Expected, got)
		}
		did.stringify++
		asserted = true
	}

	if len(c.Typed) > 0 {
		value, err := ParseWith(source, options)
		if err != nil {
			return fmt.Errorf("typed: %v", err)
		}
		if !typedMatches(typed(value), c.Typed) {
			return fmt.Errorf("typed: %v does not match the expected", typed(value))
		}
		did.typed++
		asserted = true
	}

	if c.Lint != nil {
		produced := map[string]bool{}
		for _, d := range Lint(source, options.sourceName()) {
			produced[string(d.Code)] = true
		}
		for _, want := range c.Lint {
			if !produced[want] {
				return fmt.Errorf("expected lint %s", want)
			}
		}
		did.lint++
		asserted = true
	}

	if !asserted {
		return fmt.Errorf("the fixture asserts nothing")
	}
	return nil
}

func runDatasign(c conformanceCase, source string, options ParseOptions, did *checked) error {
	value, err := ParseWith(source, options)
	if c.Error != "" {
		if err == nil {
			return fmt.Errorf("expected %s, but the document typed successfully", c.Error)
		}
		if err := matchError(c, err, did); err != nil {
			return err
		}
		did.datasign++
		return nil
	}
	if err != nil {
		return fmt.Errorf("datasign: %v", err)
	}
	if !typedMatches(value, c.Datasign.Typed) {
		return fmt.Errorf("datasign: %v does not match the expected", value)
	}
	did.datasign++
	return nil
}

func matchError(c conformanceCase, err error, did *checked) error {
	deonErr, ok := err.(*Error)
	if !ok {
		return fmt.Errorf("a non-Deon error escaped: %v", err)
	}
	if string(deonErr.Code) != c.Error {
		return fmt.Errorf("expected %s, got %s (%s)", c.Error, deonErr.Code, deonErr.Message)
	}
	did.errored++
	if c.Position != nil {
		span := deonErr.Diagnostics[0].Span
		if span.Line != c.Position.Line || span.Column != c.Position.Column {
			return fmt.Errorf("%s expected at %d:%d, reported at %d:%d", c.Error, c.Position.Line, c.Position.Column, span.Line, span.Column)
		}
		did.position++
	}
	return nil
}

func stringifyOptionsOf(given map[string]any) StringifyOptions {
	options := DefaultStringifyOptions()
	boolAt := func(key string, fallback bool) bool {
		if v, ok := given[key]; ok {
			return v == true
		}
		return fallback
	}
	options.Canonical = boolAt("canonical", false)
	options.Readable = boolAt("readable", true)
	options.Leaflinks = boolAt("leaflinks", false)
	options.LeaflinkShortening = boolAt("leaflinkShortening", true)
	options.GeneratedHeader = boolAt("generatedHeader", false)
	options.GeneratedComments = boolAt("generatedComments", false)
	if v, ok := given["indentation"]; ok {
		if n, ok := v.(float64); ok {
			options.Indentation = int(n)
		}
	}
	if v, ok := given["leaflinkLevel"]; ok {
		if n, ok := v.(float64); ok {
			options.LeaflinkLevel = int(n)
		}
	}
	return options
}

// #region matching
func valueMatches(value Value, expected json.RawMessage) bool {
	var want any
	if err := json.Unmarshal(expected, &want); err != nil {
		return false
	}
	return deonMatches(value, want)
}

func deonMatches(value Value, want any) bool {
	switch w := want.(type) {
	case string:
		s, ok := value.(string)
		return ok && s == w
	case []any:
		list, ok := value.([]Value)
		if !ok || len(list) != len(w) {
			return false
		}
		for i := range list {
			if !deonMatches(list[i], w[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		m, ok := value.(*Map)
		if !ok || m.Len() != len(w) {
			return false
		}
		for key, sub := range w {
			member, present := m.Get(key)
			if !present || !deonMatches(member, sub) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// typedMatches compares a typed or datasigned value against the manifest's JSON. A boolean is settled
// before a number, because in the manifest true and 1 are different things and the typer's job is to
// tell them apart.
func typedMatches(value any, expected json.RawMessage) bool {
	var want any
	if err := json.Unmarshal(expected, &want); err != nil {
		return false
	}
	return typedValueMatches(value, want)
}

func typedValueMatches(value any, want any) bool {
	switch w := want.(type) {
	case bool:
		b, ok := value.(bool)
		return ok && b == w
	case float64:
		if _, isBool := value.(bool); isBool {
			return false
		}
		n, ok := asFloat(value)
		return ok && (n == w || math.Abs(n-w) < 1e-9)
	case string:
		s, ok := value.(string)
		return ok && s == w
	case []any:
		list, ok := asSlice(value)
		if !ok || len(list) != len(w) {
			return false
		}
		for i := range list {
			if !typedValueMatches(list[i], w[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		return typedMapMatches(value, w)
	default:
		return false
	}
}

func typedMapMatches(value any, want map[string]any) bool {
	switch m := value.(type) {
	case *Map:
		if m.Len() != len(want) {
			return false
		}
		for key, sub := range want {
			member, present := m.Get(key)
			if !present || !typedValueMatches(member, sub) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func asFloat(value any) (float64, bool) {
	switch n := value.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func asSlice(value any) ([]any, bool) {
	switch v := value.(type) {
	case []any:
		return v, true
	case []Value:
		out := make([]any, len(v))
		for i := range v {
			out[i] = v[i]
		}
		return out, true
	default:
		return nil, false
	}
}

// #endregion matching

// #region invariants
func TestCanonicalRoundTrips(t *testing.T) {
	raw, _ := os.ReadFile(manifestPath)
	var manifest struct {
		Cases []conformanceCase `json:"cases"`
	}
	json.Unmarshal(raw, &manifest)

	for _, c := range manifest.Cases {
		if c.Error != "" || c.Feature != "" {
			continue
		}
		value, err := ParseWith(sourceOf(c), optionsOf(c))
		if err != nil {
			continue
		}
		again, err := Parse(canonical(value))
		if err != nil {
			t.Errorf("%s: canonical does not re-parse: %v", c.ID, err)
			continue
		}
		if !Equal(again, value) {
			t.Errorf("%s: parse(canonical(v)) != v", c.ID)
		}
	}
}

func TestRewrittenKeyMovesToItsFinalPosition(t *testing.T) {
	value, _ := Parse("{ a one\nb two\na three }")
	got := Stringify(value, StringifyOptions{})
	if want := "{\n    b two\n    a three\n}\n"; got != want {
		t.Errorf("expected %q, got %q", want, got)
	}
}

func TestColumnCountsCodePoints(t *testing.T) {
	_, err := Parse("{\n    ключ value\n}\n")
	deonErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("expected a Deon error, got %v", err)
	}
	span := deonErr.Diagnostics[0].Span
	if span.Line != 2 || span.Column != 5 {
		t.Errorf("expected 2:5, got %d:%d", span.Line, span.Column)
	}
}

// keep sort imported for future ordering assertions
var _ = sort.Strings
var _ = strings.TrimSpace

// #endregion invariants
