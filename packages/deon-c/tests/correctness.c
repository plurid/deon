#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Regression tests for four C-local correctness fixes, driven through the public API rather than the
 * fixtures, because they probe boundaries the language-neutral corpus does not reach:
 *
 *   - a list index far past 32 bits must be refused, not silently wrapped (specification section 6);
 *   - an imported JSON that nests past the value-nesting limit must be refused with DEON_PARSE_EXPECTED
 *     at a real one-based position, never DEON_RESOURCE_FORMAT and never 0:0 (section 11.1, section 15).
 *
 * Each `check` prints a line, and the process exits non-zero if any fails, matching depth.c. */

static int failures = 0;
static void check(bool ok, const char *what) {
    if (ok) printf("ok   %s\n", what);
    else { printf("FAIL %s\n", what); failures++; }
}

/* #region helpers */
/* An evaluated document from a bare source, no resources. */
static deon_document *evaluate(const char *source) {
    deon_options o;
    memset(&o, 0, sizeof(o));
    o.source_name = "main.deon";
    return deon_parse_with(source, strlen(source), &o);
}

/* True when the document was refused with exactly this code. */
static bool refused_with(deon_document *doc, deon_code code) {
    if (deon_document_ok(doc)) return false;
    return deon_document_error(doc)->code == code;
}

/* The position of a refused document's first diagnostic. */
static deon_span refusal_span(deon_document *doc) {
    return deon_document_error(doc)->diagnostics[0].span;
}
/* #endregion */

/* #region bug 1 — a list index is not truncated to 32 bits */
static void list_index_range(void) {
    /* #items has three entries, so 0..2 resolve and everything else is out of range. The reference sits
     * on line 2, at the '#'. */
    const char *three = "items [one\ntwo\nthree]\n";

    /* A valid index still resolves to the right entry. */
    {
        deon_document *doc = evaluate("items [one\ntwo\nthree]\n{ picked #items[2] }");
        deon_value *root = deon_document_ok(doc) ? deon_document_root(doc) : NULL;
        deon_value *picked = root ? deon_map_get(root, "picked") : NULL;
        check(picked && picked->kind == DEON_STRING && strcmp(picked->as.string.data, "three") == 0,
              "list index [2] resolves to the third entry");
        deon_document_free(doc);
    }

    /* A plainly out-of-range index is refused — the behaviour the large indices must share. */
    {
        char src[128];
        snprintf(src, sizeof(src), "%s{ picked #items[3] }", three);
        deon_document *doc = evaluate(src);
        check(refused_with(doc, DEON_UNRESOLVED_LINK), "list index [3] is out of range");
        deon_document_free(doc);
    }

    /* 2^32: (int)strtol wrapped this to 0 and returned the first entry. It must be out of range. */
    {
        char src[128];
        snprintf(src, sizeof(src), "%s{ picked #items[4294967296] }", three);
        deon_document *doc = evaluate(src);
        check(refused_with(doc, DEON_UNRESOLVED_LINK), "list index 2^32 is out of range (no 32-bit wrap)");
        deon_document_free(doc);
    }

    /* 2^32 + 1 wrapped to 1 and returned the second entry. Also out of range. */
    {
        char src[128];
        snprintf(src, sizeof(src), "%s{ picked #items[4294967297] }", three);
        deon_document *doc = evaluate(src);
        check(refused_with(doc, DEON_UNRESOLVED_LINK), "list index 2^32+1 is out of range (no 32-bit wrap)");
        deon_document_free(doc);
    }

    /* A value past 64 bits (strtoll reports ERANGE) is out of range, not a host-defined truncation. */
    {
        char src[160];
        snprintf(src, sizeof(src), "%s{ picked #items[99999999999999999999999999999999] }", three);
        deon_document *doc = evaluate(src);
        check(refused_with(doc, DEON_UNRESOLVED_LINK), "list index past 64 bits is out of range (ERANGE)");
        deon_document_free(doc);
    }
}
/* #endregion */

/* #region bug 2 — an over-deep imported JSON is refused with a real position */
/* A JSON document of `levels` nested arrays with a leaf number: "[[[...1...]]]". */
static char *nested_json(int levels) {
    char *s = malloc((size_t)levels * 2 + 2);
    int i = 0;
    for (; i < levels; i++) s[i] = '[';
    s[i++] = '1';
    for (int j = 0; j < levels; j++) s[i++] = ']';
    s[i] = '\0';
    return s;
}

/* Import `json` as ./d.json and evaluate `#d`, with the resource served from memory. */
static deon_document *import_json(const char *json) {
    deon_pair files[1];
    files[0].key = "/p/d.json";
    files[0].value = json;

    deon_options o;
    memset(&o, 0, sizeof(o));
    o.source_name = "main.deon";
    o.filebase = "/p";
    o.resources = files;
    o.resources_len = 1;
    o.allow_filesystem = true;

    const char *source = "import d from ./d.json\n{ #d }";
    return deon_parse_with(source, strlen(source), &o);
}

static void deep_json_import(void) {
    /* A shallow import still succeeds. */
    {
        char *json = nested_json(5);
        deon_document *doc = import_json(json);
        check(deon_document_ok(doc), "a shallow JSON import evaluates");
        deon_document_free(doc);
        free(json);
    }

    /* 600 deep — past the internal reader cap that used to report DEON_RESOURCE_FORMAT — and 200 deep,
     * past only the value-nesting limit. Both must be DEON_PARSE_EXPECTED at a real one-based position,
     * re-anchored to the importing statement on line 1 (never 0:0). */
    const int depths[] = {200, 600};
    for (size_t k = 0; k < sizeof(depths) / sizeof(depths[0]); k++) {
        char *json = nested_json(depths[k]);
        deon_document *doc = import_json(json);
        char label[96];

        snprintf(label, sizeof(label), "a %d-deep JSON import is refused DEON_PARSE_EXPECTED", depths[k]);
        bool code_ok = refused_with(doc, DEON_PARSE_EXPECTED);
        check(code_ok, label);

        if (code_ok) {
            deon_span span = refusal_span(doc);
            snprintf(label, sizeof(label), "a %d-deep JSON import reports a one-based position (not 0:0)", depths[k]);
            check(span.line >= 1 && span.column >= 1, label);
            snprintf(label, sizeof(label), "a %d-deep JSON import re-anchors to the import statement at 1:1", depths[k]);
            check(span.line == 1 && span.column == 1, label);
        }

        deon_document_free(doc);
        free(json);
    }
}
/* #endregion */

int main(void) {
    list_index_range();
    deep_json_import();

    if (failures == 0) { printf("all correctness checks passed\n"); return 0; }
    fprintf(stderr, "\n%d correctness failure(s)\n", failures);
    return 1;
}
