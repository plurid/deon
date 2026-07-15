package deon

// lintDocument reports what is legal and questionable, without throwing (spec/diagnostics.md). The
// one warning is a directly repeated explicit map key (specification 5): the language allows it and
// last-write-wins, but it is almost always a mistake. A key replaced by a spread does not warn,
// because that is how a document composed from others is meant to work.
func lintDocument(doc *document) []Diagnostic {
	var diagnostics []Diagnostic
	lintNode(doc.root, &diagnostics)
	for i := range doc.declarations {
		if doc.declarations[i].kind == declLeaflink {
			lintNode(doc.declarations[i].value, &diagnostics)
		}
	}
	return diagnostics
}

func lintNode(n node, diagnostics *[]Diagnostic) {
	switch node := n.(type) {
	case *mapNode:
		seen := map[string]bool{}
		for _, entry := range node.entries {
			if entry.spread != nil {
				continue
			}
			if seen[entry.key] {
				*diagnostics = append(*diagnostics, diagnosticOf(
					LintDuplicateKey,
					// This message reaches the `deon lint` tool's standard output, which the
					// cross-implementation CLI harness compares character for character, so the four
					// implementations agree on it verbatim.
					"Map key '"+entry.key+"' is written more than once.",
					entry.keySpan,
				))
			}
			seen[entry.key] = true
			if entry.value != nil {
				lintNode(entry.value, diagnostics)
			}
		}
	case *listNode:
		for _, item := range node.items {
			if item.value != nil {
				lintNode(item.value, diagnostics)
			}
		}
	case *structureNode:
		for _, row := range node.rows {
			for _, cell := range row {
				lintNode(cell, diagnostics)
			}
		}
	}
}
