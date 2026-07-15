#include "internal.h"

#include <stdio.h>
#include <stdlib.h>

/* The nesting limit (DEON_MAX_DEPTH) is enforced on a value built by hand and never parsed, the same way
 * the parser enforces it on input (section 11.1). A value that nests past the limit must fail through an
 * error channel — a NULL return with DEON_PARSE_EXPECTED — rather than a silent empty string or a crash.
 * A value within the limit must round-trip as before. */

static int failures = 0;
static void check(bool ok, const char *what) {
    if (ok) printf("ok   %s\n", what);
    else { printf("FAIL %s\n", what); failures++; }
}

/* A linear chain of `levels` nested lists with a leaf string at the bottom. The leaf sits at depth
 * `levels`, so guard_depth (which fails when a frame's depth exceeds DEON_MAX_DEPTH) refuses it exactly
 * when levels > DEON_MAX_DEPTH. */
static deon_value *nest_lists(arena *a, int levels) {
    deon_value *inner = value_string_cstr(a, "leaf");
    for (int i = 0; i < levels; i++) {
        deon_value *l = value_empty_list(a);
        list_push(a, l, inner);
        inner = l;
    }
    return inner;
}

int main(void) {
    arena *a = arena_new();
    deon_document *doc = deon_parse("{}", 2); /* a live document, for its arena, to type into */

    /* ~130 deep: past the limit of 128 enclosing values. */
    deon_value *deep = nest_lists(a, 130);

    deon_stringify_options so = deon_default_stringify_options();
    size_t n;
    deon_code code;

    code = DEON_OK;
    char *s = deon_stringify(deep, &so, &n, &code);
    check(s == NULL && code == DEON_PARSE_EXPECTED, "stringify refuses a too-deep value");
    free(s);

    code = DEON_OK;
    char *c = deon_canonical(deep, &n, &code);
    check(c == NULL && code == DEON_PARSE_EXPECTED, "canonical refuses a too-deep value");
    free(c);

    code = DEON_OK;
    deon_value *t = deon_typed(doc, deep, &code);
    check(t == NULL && code == DEON_PARSE_EXPECTED, "typed refuses a too-deep value");

    /* A NULL error out-param must be tolerated, not dereferenced. */
    char *s2 = deon_stringify(deep, &so, &n, NULL);
    check(s2 == NULL, "stringify tolerates a NULL error param on failure");
    free(s2);

    /* A shallow value succeeds, with the OK code and non-NULL output. */
    deon_value *shallow = nest_lists(a, 5);

    code = DEON_PARSE_EXPECTED;
    char *ss = deon_stringify(shallow, &so, &n, &code);
    check(ss != NULL && code == DEON_OK, "stringify accepts a shallow value");
    free(ss);

    code = DEON_PARSE_EXPECTED;
    char *sc = deon_canonical(shallow, &n, &code);
    check(sc != NULL && code == DEON_OK, "canonical accepts a shallow value");
    free(sc);

    code = DEON_PARSE_EXPECTED;
    deon_value *st = deon_typed(doc, shallow, &code);
    check(st != NULL && code == DEON_OK, "typed accepts a shallow value");

    deon_document_free(doc);
    arena_free(a);

    if (failures == 0) { printf("all depth-guard checks passed\n"); return 0; }
    fprintf(stderr, "\n%d depth-guard failure(s)\n", failures);
    return 1;
}
