package deon

import (
	"strconv"
	"strings"
)

// interpreter evaluates a parsed document into a Deon value (specification 11). Declarations are
// resolved lazily and memoized, which is equivalent to the topological resolution the specification
// describes and detects a cycle at the reference that closes it (§11.2).
type interpreter struct {
	options      *ParseOptions
	declarations map[string]*declaration
	cache        map[string]Value
	resolving    map[string]bool // declaration names mid-evaluation, for cycle detection
	calling      map[string]bool // entity names mid-call, for recursive-call cycles
	locals       []map[string]string
	opened       map[string]bool // resource identifiers being loaded, for import cycles
}

func newInterpreter(options *ParseOptions) *interpreter {
	return &interpreter{
		options:      options,
		declarations: map[string]*declaration{},
		cache:        map[string]Value{},
		resolving:    map[string]bool{},
		calling:      map[string]bool{},
		opened:       map[string]bool{},
	}
}

func (in *interpreter) run(doc *document) Value {
	// A self-importing document is a cycle, not a loop: seed the open set with this document's name.
	if in.options.sourceName() != "" {
		in.opened[in.options.sourceName()] = true
	}

	for i := range doc.declarations {
		decl := &doc.declarations[i]
		if first, exists := in.declarations[decl.name]; exists {
			// The repeat stays the primary span; the first declaration becomes the single related span
			// the reader is sent to (spec/diagnostics.md).
			fail(DuplicateDeclaration,
				"The name '"+decl.name+"' is declared more than once.", decl.nameSpan, first.nameSpan)
		}
		in.declarations[decl.name] = decl
	}

	return in.eval(doc.root)
}

// #region evaluation
func (in *interpreter) eval(n node) Value {
	switch node := n.(type) {
	case *scalarNode:
		return in.evalScalar(node)
	case *mapNode:
		return in.evalMap(node)
	case *listNode:
		return in.evalList(node)
	case *structureNode:
		return in.evalStructure(node)
	case *linkNode:
		// A link's diagnostic (unresolved, or a cycle it closes) is reported at the link as written,
		// from its `#`, rather than at the reference name after it.
		ref := node.ref
		ref.span = node.span
		return in.resolveReference(ref)
	case *callNode:
		return in.evalCall(node)
	default:
		return ""
	}
}

func (in *interpreter) evalScalar(n *scalarNode) Value {
	var b strings.Builder
	for _, part := range n.parts {
		if part.interp == nil {
			b.WriteString(part.literal)
			continue
		}
		// An interpolation is reported at the string that carries it, not at a position inside it: the
		// reference within was recovered by decoding and has no source position of its own.
		ref := *part.interp
		ref.span = n.span
		value := in.resolveReference(ref)
		text, ok := value.(string)
		if !ok {
			fail(TypeMismatch, "An interpolation must resolve to a string.", n.span)
		}
		b.WriteString(text)
	}
	return b.String()
}

func (in *interpreter) evalMap(n *mapNode) Value {
	result := NewMap()
	for _, entry := range n.entries {
		if entry.spread != nil {
			in.spreadIntoMap(result, *entry.spread)
			continue
		}
		result.Set(entry.key, in.eval(entry.value))
	}
	return result
}

func (in *interpreter) evalList(n *listNode) Value {
	result := []Value{}
	for _, item := range n.items {
		if item.spread != nil {
			result = in.spreadIntoList(result, *item.spread)
			continue
		}
		result = append(result, in.eval(item.value))
	}
	return result
}

func (in *interpreter) evalStructure(n *structureNode) Value {
	result := []Value{}
	for _, row := range n.rows {
		entry := NewMap()
		for i, field := range n.fields {
			entry.Set(field, in.eval(row[i]))
		}
		result = append(result, entry)
	}
	return result
}

// #endregion evaluation

// #region spread
func (in *interpreter) spreadIntoMap(dest *Map, ref reference) {
	value := in.resolveReference(ref)
	switch source := value.(type) {
	case *Map:
		for _, key := range source.Keys() {
			v, _ := source.Get(key)
			dest.Set(key, v)
		}
	case string:
		// A string spreads into a map using decimal character indices (specification 7).
		for i, r := range []rune(source) {
			dest.Set(strconv.Itoa(i), string(r))
		}
	default:
		fail(TypeMismatch, "A list cannot spread into a map.", ref.span)
	}
}

func (in *interpreter) spreadIntoList(dest []Value, ref reference) []Value {
	value := in.resolveReference(ref)
	switch source := value.(type) {
	case []Value:
		return append(dest, source...)
	case string:
		// A string spreads into a list as Unicode code points (specification 7).
		for _, r := range source {
			dest = append(dest, string(r))
		}
		return dest
	default:
		fail(TypeMismatch, "A map cannot spread into a list.", ref.span)
		return dest
	}
}

// #endregion spread

// #region references
func (in *interpreter) resolveReference(ref reference) Value {
	if ref.env {
		if in.options.Environment != nil {
			if value, ok := in.options.Environment[ref.head]; ok {
				return value
			}
		}
		return ""
	}

	value := in.resolveHead(ref.head, ref.span)
	return in.applyAccess(value, ref.access, ref.span)
}

func (in *interpreter) resolveHead(name string, span Span) Value {
	// A call-local binding shadows an outer leaflink for the duration of the call (specification 10).
	for i := len(in.locals) - 1; i >= 0; i-- {
		if value, ok := in.locals[i][name]; ok {
			return value
		}
	}

	decl, ok := in.declarations[name]
	if !ok {
		fail(UnresolvedLink, "There is no declaration named '"+name+"'.", span)
	}

	if cached, done := in.cache[name]; done {
		return cached
	}
	if in.resolving[name] {
		// Reported at the reference that closed the loop, not the declaration that opened it (§11.2).
		fail(Cycle, "The declaration '"+name+"' depends on itself.", span)
	}

	in.resolving[name] = true
	value := in.evalDeclaration(decl)
	delete(in.resolving, name)
	in.cache[name] = value
	return value
}

func (in *interpreter) evalDeclaration(decl *declaration) Value {
	switch decl.kind {
	case declLeaflink:
		return in.eval(decl.value)
	case declImport:
		return in.evalImport(decl)
	case declInject:
		return in.evalInject(decl)
	default:
		return ""
	}
}

func (in *interpreter) applyAccess(value Value, access []accessSegment, span Span) Value {
	for _, segment := range access {
		switch container := value.(type) {
		case *Map:
			key := segment.name
			member, ok := container.Get(key)
			if !ok {
				fail(UnresolvedLink, "There is no member '"+key+"'.", span)
			}
			value = member
		case []Value:
			if !segment.byIndex {
				fail(UnresolvedLink, "A list is indexed by a number, not by '"+segment.name+"'.", span)
			}
			if segment.index < 0 || segment.index >= len(container) {
				fail(UnresolvedLink, "The list index "+strconv.Itoa(segment.index)+" is out of range.", span)
			}
			value = container[segment.index]
		default:
			fail(UnresolvedLink, "A string has no members to access.", span)
		}
	}
	return value
}

// #endregion references

// #region entity calls
func (in *interpreter) evalCall(n *callNode) Value {
	name := n.ref.head
	if len(n.ref.access) > 0 {
		fail(UnresolvedLink, "A call names a leaflink directly.", n.span)
	}

	decl, ok := in.declarations[name]
	if !ok || decl.kind != declLeaflink {
		fail(UnresolvedLink, "There is no entity named '"+name+"' to call.", n.span)
	}

	params := interpolationNames(decl.value)

	locals := map[string]string{}
	for _, arg := range n.args {
		if _, dup := locals[arg.name]; dup {
			// Every argument fault anchors its primary span at the opening '(' (argsSpan); the offending
			// argument's name becomes the single related span the reader is sent to (spec §11.2).
			fail(EntityArgument, "The argument '"+arg.name+"' is given more than once.", n.argsSpan, arg.nameSpan)
		}
		if !params[arg.name] {
			fail(EntityArgument, "'"+name+"' has no parameter '"+arg.name+"'.", n.argsSpan, arg.nameSpan)
		}
		value := in.eval(arg.value)
		text, isString := value.(string)
		if !isString {
			fail(EntityArgument, "The argument '"+arg.name+"' must be a string.", n.argsSpan, arg.nameSpan)
		}
		locals[arg.name] = text
	}
	for param := range params {
		if _, given := locals[param]; !given {
			fail(EntityArgument, "'"+name+"' is missing the argument '"+param+"'.", n.argsSpan)
		}
	}

	if in.calling[name] {
		fail(Cycle, "The entity '"+name+"' calls itself.", n.span)
	}
	in.calling[name] = true
	in.locals = append(in.locals, locals)

	// Every call evaluates an independent copy: the entity body is re-evaluated from its node, so two
	// calls with different arguments do not share a memoized value.
	value := in.eval(decl.value)

	in.locals = in.locals[:len(in.locals)-1]
	delete(in.calling, name)
	return value
}

// interpolationNames collects the interpolation names an entity carries, which are its exact
// parameter set (specification 10). A link (`#voice`) composes and stays private; an interpolation
// (`#{voice}`) is a hole and is always a parameter, even when a leaflink of that name exists.
func interpolationNames(n node) map[string]bool {
	names := map[string]bool{}
	var walk func(node)
	walk = func(n node) {
		switch node := n.(type) {
		case *scalarNode:
			for _, part := range node.parts {
				if part.interp != nil && !part.interp.env {
					names[part.interp.head] = true
				}
			}
		case *mapNode:
			for _, entry := range node.entries {
				if entry.value != nil {
					walk(entry.value)
				}
			}
		case *listNode:
			for _, item := range node.items {
				if item.value != nil {
					walk(item.value)
				}
			}
		case *structureNode:
			for _, row := range node.rows {
				for _, cell := range row {
					walk(cell)
				}
			}
		}
	}
	walk(n)
	return names
}

// #endregion entity calls
