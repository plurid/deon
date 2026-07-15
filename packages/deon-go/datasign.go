package deon

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Typing a document against a declared contract (specification 14.1). The conservative typer of §14
// guesses from the value, so it must refuse whenever a guess could be wrong. A datasign contract is
// the other half: it supplies the intent the value cannot carry, and 007 becomes 7 exactly where a
// contract declared it a number, and nowhere else. This is an adapter to the datasign format, which
// belongs to its own project, and the rules below are that format's own.

const datasignSource = "<datasign>"

type datasignField struct {
	name     string
	declared string
	required bool
}

type signatures map[string][]datasignField

// sign applies the caller's contracts to an evaluated root (specification 14.1). Nothing happens
// without a datasign map: an empty map is the identity, and there is no reason to read a contract
// nobody is going to apply.
func sign(root Value, options *ParseOptions) Value {
	if len(options.DatasignMap) == 0 {
		return root
	}

	sigs := signatures{}
	for _, file := range options.DatasignFiles {
		source := readContract(file, options)
		for name, fields := range parseDatasign(source) {
			sigs[name] = fields
		}
	}

	return applyDatasign(root, sigs, options.DatasignMap)
}

// readContract reads a .datasign file. Reading one is filesystem access like any other and subject to
// §9: a raw string handed to Parse grants nothing, so a contract it names may not be read from a disk.
// A contract supplied in Resources needs no grant, because nothing is being reached.
func readContract(file string, options *ParseOptions) string {
	target := file
	if !filepath.IsAbs(file) && options.Filebase != "" {
		target = filepath.Join(options.Filebase, file)
	}

	if data, ok := options.Resources[target]; ok {
		return data
	}
	if data, ok := options.Resources[file]; ok {
		return data
	}

	if !options.AllowFilesystem {
		fail(CapabilityDenied,
			"Reading the datasign file '"+file+"' requires filesystem access.", headSpan(file))
	}
	bytes, err := os.ReadFile(target)
	if err != nil {
		fail(ResourceIO, "Unable to read the datasign file '"+file+"'.", headSpan(file))
	}
	return string(bytes)
}

// #region reading a contract
var datasignEntity = regexp.MustCompile(`^\s*data\s+(\w+)\s*\{`)

func parseDatasign(source string) signatures {
	sigs := signatures{}
	open := ""

	for _, line := range strings.Split(source, "\n") {
		trimmed := strings.TrimLeft(line, " \t")
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "/*") ||
			strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "@") {
			continue
		}

		value := line
		if at := strings.Index(value, "//"); at >= 0 {
			value = value[:at]
		}
		if strings.TrimSpace(value) == "" {
			continue
		}

		if match := datasignEntity.FindStringSubmatch(value); match != nil {
			open = match[1]
			sigs[open] = []datasignField{}
			continue
		}
		if strings.HasPrefix(strings.TrimLeft(value, " \t"), "}") {
			open = ""
			continue
		}
		if open == "" {
			continue
		}

		colon := strings.Index(value, ":")
		if colon == -1 {
			continue
		}

		// A `?` anywhere on the line marks the field optional — datasign's own rule — and is removed
		// from both the name and the type, so `nickname?: string` and `nickname: string?` are one
		// declaration.
		optional := strings.Contains(value, "?")
		name := strings.ReplaceAll(strings.TrimSpace(value[:colon]), "?", "")
		declared := strings.ReplaceAll(strings.TrimSpace(strings.TrimRight(strings.TrimSpace(value[colon+1:]), ";")), "?", "")
		if name == "" || declared == "" {
			continue
		}

		sigs[open] = append(sigs[open], datasignField{name: name, declared: declared, required: !optional})
	}

	return sigs
}

// #endregion reading a contract

// #region numbers
var datasignDecimal = regexp.MustCompile(`^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$`)

// datasignNumeric reads a string as a number the way ECMAScript's Number(string) does, which §14.1
// fixes as the grammar — wider than Go's own strconv, and different from it: Go parses "inf" and
// rejects "0x10", where this must reject the first and read the second as 16. So the grammar is
// written out rather than delegated to the host.
func datasignNumeric(text string) (float64, bool) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0, false
	}

	for _, radix := range []struct {
		prefix string
		base   int
	}{{"0x", 16}, {"0X", 16}, {"0o", 8}, {"0O", 8}, {"0b", 2}, {"0B", 2}} {
		if strings.HasPrefix(trimmed, radix.prefix) {
			n, err := strconv.ParseUint(trimmed[2:], radix.base, 64)
			if err != nil {
				return 0, false
			}
			return float64(n), true
		}
	}

	if !datasignDecimal.MatchString(trimmed) {
		return 0, false
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || isInfOrNaN(n) {
		return 0, false
	}
	return n, true
}

// #endregion numbers

// #region applying a contract
func datasignDescribe(value Value) string {
	switch value.(type) {
	case string:
		return "a string"
	case []Value:
		return "a list"
	case *Map:
		return "a map"
	default:
		return "a value"
	}
}

// verbatim carries a value the contract said nothing about across unchanged. Emphatically not the
// typer, which guesses: a key the contract does not mention has not been declared to be anything.
func verbatim(value Value) any {
	switch v := value.(type) {
	case []Value:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = verbatim(item)
		}
		return out
	case *Map:
		out := NewMap()
		for _, key := range v.Keys() {
			member, _ := v.Get(key)
			out.Set(key, verbatim(member))
		}
		return out
	default:
		return value
	}
}

func typeDatasign(value Value, declared string, sigs signatures, path string) any {
	declared = strings.TrimSpace(declared)

	if strings.HasSuffix(declared, "[]") {
		list, ok := value.([]Value)
		if !ok {
			fail(TypeMismatch, "Expected '"+path+"' to be a list for '"+declared+"', found "+datasignDescribe(value)+".", headSpan(datasignSource))
		}
		item := strings.TrimSpace(declared[:len(declared)-2])
		out := make([]any, len(list))
		for i, entry := range list {
			out[i] = typeDatasign(entry, item, sigs, path+"["+strconv.Itoa(i)+"]")
		}
		return out
	}

	if declared == "string" || declared == "number" || declared == "boolean" {
		text, ok := value.(string)
		if !ok {
			fail(TypeMismatch, "Expected '"+path+"' to be a string for '"+declared+"', found "+datasignDescribe(value)+".", headSpan(datasignSource))
		}
		switch declared {
		case "string":
			return text
		case "boolean":
			if text == "true" {
				return true
			}
			if text == "false" {
				return false
			}
			fail(TypeMismatch, "Expected '"+path+"' to be 'true' or 'false' for 'boolean', found '"+text+"'.", headSpan(datasignSource))
		default:
			n, ok := datasignNumeric(text)
			if !ok {
				fail(TypeMismatch, "Expected '"+path+"' to be a number, found '"+text+"'.", headSpan(datasignSource))
			}
			return n
		}
	}

	entity, ok := sigs[declared]
	if !ok {
		// A type defined somewhere else; a value is not guessed at merely because its type was not
		// found.
		return verbatim(value)
	}

	container, ok := value.(*Map)
	if !ok {
		fail(TypeMismatch, "Expected '"+path+"' to be a map for '"+declared+"', found "+datasignDescribe(value)+".", headSpan(datasignSource))
	}

	fields := map[string]datasignField{}
	for _, field := range entity {
		fields[field.name] = field
	}

	out := NewMap()
	for _, key := range container.Keys() {
		member, _ := container.Get(key)
		if field, declared := fields[key]; declared {
			out.Set(key, typeDatasign(member, field.declared, sigs, path+"."+key))
		} else {
			out.Set(key, verbatim(member))
		}
	}
	for _, field := range entity {
		if field.required && !container.Has(field.name) {
			fail(TypeMismatch, "Required field '"+path+"."+field.name+"' of '"+declared+"' is missing.", headSpan(datasignSource))
		}
	}
	return out
}

func applyDatasign(root Value, sigs signatures, mapping map[string]string) any {
	if len(mapping) == 0 {
		return verbatim(root)
	}

	container, ok := root.(*Map)
	if !ok {
		fail(TypeMismatch, "A datasign map requires a root map, found "+datasignDescribe(root)+".", headSpan(datasignSource))
	}

	out := NewMap()
	for _, key := range container.Keys() {
		member, _ := container.Get(key)
		if declared, named := mapping[key]; named {
			out.Set(key, typeDatasign(member, declared, sigs, key))
		} else {
			out.Set(key, verbatim(member))
		}
	}
	return out
}

// #endregion applying a contract
