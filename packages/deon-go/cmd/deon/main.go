// The `deon` command. The same surface as the JavaScript, Rust, and Python tools, command for
// command, and differentially tested against them by scripts/cli-harness.py — the exit status, the
// standard output, and the files written are byte-identical, because a tool is only interchangeable
// with its siblings if a script cannot tell which one it called.
//
// The defaults are the tool's, not the library's:
//
//	--output deon    --typed false    --filesystem TRUE    --network false
//
// A file named on a command line was named by a person, so it may read the disk; nothing said it may
// reach the network. The library grants neither, because a document handed to a library came from
// somewhere unknown — a document handed to this came from whoever typed the command.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/plurid/deon/packages/deon-go"
)

const usage = `Usage: deon <file> [options]
       deon convert <source.json> [destination.deon]
       deon environment <source.deon> <command...>
       deon confile <files...> [--destination confile.deon]
       deon exfile <source.deon> [--unsafe-paths]
       deon lint <files...> [--warnings-as-errors]

Options:
  -o, --output <deon|json>
  -t, --typed
  -f, --filesystem <true|false>
  -n, --network <true|false>
  -d, --destination <path>
  -w, --writeover
      --unsafe-paths
      --warnings-as-errors
  -v, --version
  -h, --help
`

// failure is a complaint about the command line rather than about a document: it has no position,
// because there is no document for it to have one in.
type failure string

func (f failure) Error() string { return string(f) }

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(arguments []string) int {
	if len(arguments) == 0 || flag(arguments, "-h", "--help") {
		fmt.Print(usage)
		return 0
	}
	if flag(arguments, "-v", "--version") {
		fmt.Println(deon.Version)
		return 0
	}

	command := evaluate
	switch arguments[0] {
	case "convert":
		command = convert
	case "environment":
		command = environment
	case "confile":
		command = confile
	case "exfile":
		command = exfile
	case "lint":
		command = lint
	}

	err := command(arguments)
	if err == nil {
		return 0
	}
	if code, ok := err.(exitCode); ok {
		return int(code)
	}
	if deonErr, ok := err.(*deon.Error); ok {
		// Every diagnostic it collected, each with its own code and position — the line an editor would
		// underline. Flattening them into one sentence would throw away the only part a tool can read.
		for _, diagnostic := range deonErr.Diagnostics {
			span := diagnostic.Span
			fmt.Fprintf(os.Stderr, "%s:%d:%d %s %s %s\n",
				span.Source, span.Line, span.Column, diagnostic.Severity, diagnostic.Code, diagnostic.Message)
		}
		return 1
	}
	fmt.Fprintf(os.Stderr, "deon: %s\n", err.Error())
	return 1
}

// exitCode carries the status of a command deon ran on the caller's behalf (`environment`), so a
// non-zero status is reported without being mistaken for a diagnostic.
type exitCode int

func (c exitCode) Error() string { return "exit " + strconv.Itoa(int(c)) }

// #region argument parsing
func flag(arguments []string, names ...string) bool {
	for _, argument := range arguments {
		for _, name := range names {
			if argument == name {
				return true
			}
		}
	}
	return false
}

func option(arguments []string, short, long, fallback string) string {
	for i, argument := range arguments {
		if (argument == short || argument == long) && i+1 < len(arguments) {
			return arguments[i+1]
		}
	}
	return fallback
}

var optionsTakingValue = map[string]bool{
	"-o": true, "--output": true,
	"-f": true, "--filesystem": true,
	"-n": true, "--network": true,
	"-d": true, "--destination": true,
}

// positional returns the arguments that are neither options nor the values of options.
func positional(arguments []string) []string {
	var values []string
	skip := false
	for _, argument := range arguments {
		if skip {
			skip = false
			continue
		}
		if optionsTakingValue[argument] {
			skip = true
			continue
		}
		if strings.HasPrefix(argument, "-") {
			continue
		}
		values = append(values, argument)
	}
	return values
}

// #endregion argument parsing

// resolve names a path as the other tools resolve it: joined onto the working directory, symlinks left
// alone. This is what a diagnostic names the document by, so it must be the same string in all four or
// a script reading the output would have to know which tool produced it.
func resolve(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	cwd, err := os.Getwd()
	if err != nil {
		return path
	}
	return filepath.Join(cwd, path)
}

func read(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", failure(fmt.Sprintf("Unable to read '%s': %v", path, err))
	}
	return string(data), nil
}

func parseOptions(arguments []string, path string) deon.ParseOptions {
	resolved := resolve(path)
	options := deon.ParseOptions{
		SourceName: resolved,
		Filebase:   filepath.Dir(resolved),
		// Strict `== "true"`, so a bare `-n` is false rather than an accidental grant of the network.
		AllowFilesystem: option(arguments, "-f", "--filesystem", "true") == "true",
		AllowNetwork:    option(arguments, "-n", "--network", "false") == "true",
		Environment:     environMap(),
	}
	return options
}

func environMap() map[string]string {
	out := map[string]string{}
	for _, entry := range os.Environ() {
		if i := strings.IndexByte(entry, '='); i >= 0 {
			out[entry[:i]] = entry[i+1:]
		}
	}
	return out
}

// #region commands
func evaluate(arguments []string) error {
	path := arguments[0]
	source, err := deon.ReadFile(resolve(path))
	if err != nil {
		return err
	}

	value, err := deon.ParseWith(source, parseOptions(arguments, path))
	if err != nil {
		return err
	}

	if option(arguments, "-o", "--output", "deon") == "json" {
		if flag(arguments, "-t", "--typed") {
			typedValue, err := deon.Typed(value)
			if err != nil {
				return err
			}
			fmt.Print(encodeJSON(typedValue, 0) + "\n")
		} else {
			fmt.Print(encodeJSON(value, 0) + "\n")
		}
		return nil
	}

	written, err := deon.Stringify(value, deon.DefaultStringifyOptions())
	if err != nil {
		return err
	}
	fmt.Print(written)
	return nil
}

func convert(arguments []string) error {
	if len(arguments) < 2 {
		return failure("convert requires a source file.")
	}
	source := arguments[1]

	// Deon's own JSON reader, and not the host's: a JSON number keeps its source token spelling
	// (specification 9.1), so `1.50` converts to `1.50` and not to `1.5`.
	data, err := read(source)
	if err != nil {
		return err
	}
	value, err := deon.ReadJSON(data, source)
	if err != nil {
		return err
	}
	written, err := deon.Stringify(value, deon.DefaultStringifyOptions())
	if err != nil {
		return err
	}

	destinations := positional(arguments[2:])
	if len(destinations) > 0 {
		return os.WriteFile(destinations[0], []byte(written), 0o644)
	}
	fmt.Print(written)
	return nil
}

func environment(arguments []string) error {
	if len(arguments) < 3 {
		return failure("environment requires a source file and a command.")
	}
	source := arguments[1]

	// Not parseOptions, which reads flags out of the argument list — here the argument list is somebody
	// else's. `deon environment app.deon curl -n https://…` must pass that `-n` to `curl`.
	value, err := deon.ParseFile(source, deon.ParseOptions{})
	if err != nil {
		return err
	}
	root, ok := value.(*deon.Map)
	if !ok {
		return failure("An environment source must contain a root map.")
	}

	variables := environMap()
	writeover := flag(arguments, "-w", "--writeover")
	for _, name := range root.Keys() {
		item, _ := root.Get(name)
		text, ok := environValue(item)
		if !ok {
			continue
		}
		if _, present := variables[name]; writeover || !present {
			variables[name] = text
		}
	}

	// Everything after the source is the command, verbatim, with only this command's own flag removed.
	var command []string
	for _, argument := range arguments[2:] {
		if argument == "-w" || argument == "--writeover" {
			continue
		}
		command = append(command, argument)
	}
	if len(command) == 0 {
		return failure("environment requires a command to run.")
	}

	child := exec.Command(command[0], command[1:]...)
	child.Env = environSlice(variables)
	child.Stdin = os.Stdin
	child.Stdout = os.Stdout
	child.Stderr = os.Stderr
	if err := child.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exitCode(exit.ExitCode())
		}
		return failure(fmt.Sprintf("Unable to run '%s': %v", command[0], err))
	}
	return nil
}

func environValue(item deon.Value) (string, bool) {
	switch v := item.(type) {
	case string:
		return v, true
	case []deon.Value:
		var parts []string
		for _, part := range v {
			if s, ok := part.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, string(os.PathListSeparator)), true
	default:
		return "", false
	}
}

func environSlice(variables map[string]string) []string {
	out := make([]string, 0, len(variables))
	for name, value := range variables {
		out = append(out, name+"="+value)
	}
	return out
}

func confile(arguments []string) error {
	destination := option(arguments, "-d", "--destination", "confile.deon")

	var files []string
	for _, file := range positional(arguments[1:]) {
		if file != destination {
			files = append(files, file)
		}
	}
	if len(files) == 0 {
		return failure("confile requires at least one input file.")
	}

	root := deon.NewMap()
	for _, file := range files {
		data, err := read(file)
		if err != nil {
			return err
		}
		entry := deon.NewMap()
		entry.Set("data", data)
		// Keyed by the path as it was typed, so that exfile puts it back where it came from.
		root.Set(file, entry)
	}

	written, err := deon.Stringify(root, deon.DefaultStringifyOptions())
	if err != nil {
		return err
	}
	return os.WriteFile(destination, []byte(written), 0o644)
}

func exfile(arguments []string) error {
	if len(arguments) < 2 {
		return failure("exfile requires a source file.")
	}
	source := arguments[1]
	unsafePaths := flag(arguments, "--unsafe-paths")

	value, err := deon.ParseFile(source, deon.ParseOptions{})
	if err != nil {
		return err
	}
	root, ok := value.(*deon.Map)
	if !ok {
		return failure("An exfile source must contain a root map.")
	}

	type plan struct {
		target string
		data   string
	}
	var planned []plan

	// Every entry is checked before any is written, so a document with one bad path writes nothing at
	// all rather than leaving half an archive on the disk. A `.deon` file is data, and data must not be
	// able to write wherever it likes.
	for _, path := range root.Keys() {
		entry, _ := root.Get(path)
		data, ok := exfileData(entry)
		if !ok {
			return failure(fmt.Sprintf("Exfile entry '%s' must be a string or a map with a string data field.", path))
		}

		if !unsafePaths {
			escapes := strings.HasPrefix(filepath.Clean(path), "..")
			if filepath.IsAbs(path) || escapes {
				return failure(fmt.Sprintf("Unsafe exfile path '%s'. Use --unsafe-paths to permit it.", path))
			}
		}
		planned = append(planned, plan{target: path, data: data})
	}

	for _, item := range planned {
		if dir := filepath.Dir(item.target); dir != "." && dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
		}
		if err := os.WriteFile(item.target, []byte(item.data), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func exfileData(entry deon.Value) (string, bool) {
	switch v := entry.(type) {
	case string:
		return v, true
	case *deon.Map:
		if data, ok := v.Get("data"); ok {
			if text, ok := data.(string); ok {
				return text, true
			}
		}
	}
	return "", false
}

func lint(arguments []string) error {
	files := positional(arguments[1:])
	if len(files) == 0 {
		return failure("lint requires at least one file.")
	}

	warningsAreErrors := flag(arguments, "--warnings-as-errors")
	warned := false

	for _, file := range files {
		source, err := deon.ReadFile(resolve(file))
		if err != nil {
			return err
		}
		path := resolve(file)

		for _, diagnostic := range deon.Lint(source, path) {
			warned = true
			fmt.Printf("%s:%d:%d %s %s %s\n",
				path, diagnostic.Span.Line, diagnostic.Span.Column,
				diagnostic.Severity, diagnostic.Code, diagnostic.Message)
		}

		// Linting reports what is legal and questionable; evaluation is what surfaces what is wrong. A
		// lint that only did the first would call a broken document clean.
		if _, err := deon.ParseWith(source, parseOptions(arguments, file)); err != nil {
			return err
		}
	}

	if warned && warningsAreErrors {
		return exitCode(1)
	}
	return nil
}

// #endregion commands

// #region json
// encodeJSON writes a value as JSON in the shape json.dumps(indent=4) and JSON.stringify(v, null, 4)
// both produce, so the four tools' `-o json` output is one string. Maps keep their write order — a
// sorted encoder would disagree with the others — scalars in an untyped value stay strings, and a
// typed value's booleans and numbers are written as JSON booleans and numbers.
func encodeJSON(value any, level int) string {
	switch v := value.(type) {
	case string:
		return encodeJSONString(v)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case float64:
		return encodeJSONNumber(v)
	case []deon.Value:
		items := make([]any, len(v))
		for i := range v {
			items[i] = v[i]
		}
		return encodeJSONArray(items, level)
	case []any:
		return encodeJSONArray(v, level)
	case *deon.Map:
		return encodeJSONMap(v.Keys(), func(key string) any { m, _ := v.Get(key); return m }, level)
	default:
		return "null"
	}
}

func encodeJSONArray(items []any, level int) string {
	if len(items) == 0 {
		return "[]"
	}
	inner := strings.Repeat(" ", (level+1)*4)
	var b strings.Builder
	b.WriteString("[\n")
	for i, item := range items {
		if i > 0 {
			b.WriteString(",\n")
		}
		b.WriteString(inner)
		b.WriteString(encodeJSON(item, level+1))
	}
	b.WriteString("\n")
	b.WriteString(strings.Repeat(" ", level*4))
	b.WriteString("]")
	return b.String()
}

func encodeJSONMap(keys []string, get func(string) any, level int) string {
	if len(keys) == 0 {
		return "{}"
	}
	inner := strings.Repeat(" ", (level+1)*4)
	var b strings.Builder
	b.WriteString("{\n")
	for i, key := range keys {
		if i > 0 {
			b.WriteString(",\n")
		}
		b.WriteString(inner)
		b.WriteString(encodeJSONString(key))
		b.WriteString(": ")
		b.WriteString(encodeJSON(get(key), level+1))
	}
	b.WriteString("\n")
	b.WriteString(strings.Repeat(" ", level*4))
	b.WriteString("}")
	return b.String()
}

func encodeJSONNumber(f float64) string {
	// The typer yields integers as whole float64 values; write them without a decimal point, as every
	// sibling does, so 42 is 42 and not 42.0.
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

func encodeJSONString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString("\\\"")
		case '\\':
			b.WriteString("\\\\")
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case '\t':
			b.WriteString("\\t")
		case '\b':
			b.WriteString("\\b")
		case '\f':
			b.WriteString("\\f")
		default:
			if r < 0x20 {
				b.WriteString(fmt.Sprintf("\\u%04x", r))
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// #endregion json
