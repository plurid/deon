#include "internal.h"

#include <string.h>

/* Linting reports what is legal but questionable, and never throws (diagnostics.md). The one warning is
 * a directly repeated explicit map key (section 5): the language allows it and last-write-wins, but it
 * is almost always a mistake. A key replaced by a spread does not warn — that is how a document composed
 * from others is meant to work. */

int deon_severity_of(deon_code code);

typedef struct {
    deon_diagnostic *items;
    size_t           len;
    size_t           cap;
    arena           *a;
} diag_list;

static void diag_push(diag_list *d, deon_code code, deon_str message, deon_span span) {
    if (d->len == d->cap) {
        size_t cap = d->cap ? d->cap * 2 : 8;
        deon_diagnostic *bigger = arena_alloc(d->a, cap * sizeof(deon_diagnostic));
        if (d->len) memcpy(bigger, d->items, d->len * sizeof(deon_diagnostic));
        d->items = bigger;
        d->cap = cap;
    }
    deon_diagnostic *dg = &d->items[d->len++];
    dg->code = code;
    dg->message = message;
    dg->span = span;
    dg->severity = deon_severity_of(code);
}

static void lint_node(node *n, diag_list *d) {
    if (!n) return;
    switch (n->kind) {
        case NODE_MAP:
            for (size_t i = 0; i < n->as.map.len; i++) {
                map_entry *entry = &n->as.map.entries[i];
                if (entry->spread) continue;
                bool seen = false;
                for (size_t j = 0; j < i; j++) {
                    map_entry *prior = &n->as.map.entries[j];
                    if (!prior->spread && str_eq_str(prior->key, entry->key)) { seen = true; break; }
                }
                if (seen) {
                    /* This message reaches `deon lint`'s standard output, which the cross-implementation
                     * CLI harness compares character for character. */
                    sb b = {0};
                    sb_puts(&b, "Map key '");
                    sb_put(&b, entry->key.data, entry->key.len);
                    sb_puts(&b, "' is written more than once.");
                    deon_str msg = sb_into_arena(&b, d->a);
                    diag_push(d, DEON_LINT_DUPLICATE_KEY, msg, entry->key_span);
                }
                if (entry->has_value) lint_node(entry->value, d);
            }
            break;
        case NODE_LIST:
            for (size_t i = 0; i < n->as.list.len; i++) lint_node(n->as.list.items[i].value, d);
            break;
        case NODE_STRUCTURE:
            for (size_t r = 0; r < n->as.structure.rows_len; r++) {
                for (size_t c = 0; c < n->as.structure.fields_len; c++) {
                    lint_node(n->as.structure.cells[r * n->as.structure.fields_len + c], d);
                }
            }
            break;
        default:
            break;
    }
}

void lint_document(deon_ctx *ctx, document_ast *doc, deon_diagnostic **out, size_t *out_len) {
    diag_list d = {0};
    d.a = ctx->a;
    if (doc->has_root) lint_node(doc->root, &d);
    for (size_t i = 0; i < doc->decls_len; i++) {
        if (doc->decls[i].kind == DECL_LEAFLINK) lint_node(doc->decls[i].value, &d);
    }
    *out = d.items;
    *out_len = d.len;
}
