#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* The public surface. Everything is synchronous: a C caller who wants a parse off the current thread
 * has a thread to run it on, and an asynchronous API would buy nothing and cost a second evaluator. A
 * document owns the one arena that holds its value or its error, and deon_document_free releases all of
 * it at once — the document handle itself lives in that arena, so freeing the arena frees the handle. */

int deon_severity_of(deon_code code);

/* #region document plumbing */
static deon_document *doc_new(arena *a) {
    deon_document *doc = arena_alloc(a, sizeof(*doc));
    memset(doc, 0, sizeof(*doc));
    doc->a = a;
    return doc;
}

static deon_ctx ctx_new(arena *a) {
    deon_ctx ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.a = a;
    return ctx;
}

static void fill_error(deon_document *doc, deon_ctx *ctx) {
    doc->ok = false;
    doc->error.code = ctx->code;
    doc->error.message = ctx->message;
    deon_diagnostic *d = arena_alloc(doc->a, sizeof(*d));
    d->code = ctx->code;
    d->message = ctx->message;
    d->span = ctx->span;
    d->severity = deon_severity_of(ctx->code);
    doc->error.diagnostics = d;
    doc->error.diagnostics_len = 1;
}

static const char *source_name_of(const deon_options *o) {
    return o->source_name && o->source_name[0] ? o->source_name : "<memory>";
}
/* #endregion */

/* #region reading */
static void parse_into(deon_document *doc, deon_ctx *ctx, const char *source, size_t len, const deon_options *options) {
    document_ast *ast = parse_document(ctx, source, len, source_name_of(options));
    deon_value *root = evaluate(ctx, ast, options);
    root = sign_value(ctx, root, options);
    doc->ok = true;
    doc->root = root;
}

deon_document *deon_parse_with(const char *source, size_t len, const deon_options *options) {
    deon_options opts;
    if (options) opts = *options; else memset(&opts, 0, sizeof(opts));

    arena *a = arena_new();
    deon_document *doc = doc_new(a);
    deon_ctx ctx = ctx_new(a);
    if (setjmp(ctx.jmp)) { fill_error(doc, &ctx); return doc; }
    parse_into(doc, &ctx, source, len, &opts);
    return doc;
}

deon_document *deon_parse(const char *source, size_t len) {
    return deon_parse_with(source, len, NULL);
}

deon_document *deon_parse_file(const char *path, const deon_options *options) {
    deon_options opts;
    if (options) opts = *options; else memset(&opts, 0, sizeof(opts));

    size_t len;
    deon_code err = DEON_OK;
    char *data = deon_read_file(path, &len, &err);
    if (!data) {
        arena *a = arena_new();
        deon_document *doc = doc_new(a);
        deon_ctx ctx = ctx_new(a);
        char msg[1024];
        snprintf(msg, sizeof(msg), "Unable to read '%s'.", path);
        ctx.code = DEON_RESOURCE_IO;
        ctx.message = arena_str_cstr(a, msg);
        ctx.span = span_head(arena_str_cstr(a, path).data);
        fill_error(doc, &ctx);
        return doc;
    }

    /* dirname of the path becomes the filebase; naming the file grants the filesystem */
    char *dir = malloc(strlen(path) + 2);
    strcpy(dir, path);
    char *slash = strrchr(dir, '/');
    if (slash) *slash = '\0'; else strcpy(dir, ".");

    opts.source_name = path;
    opts.filebase = dir;
    opts.allow_filesystem = true;

    deon_document *doc = deon_parse_with(data, len, &opts);
    free(data);
    free(dir);
    return doc;
}

deon_document *deon_read_json(const char *source, size_t len, const char *source_name) {
    arena *a = arena_new();
    deon_document *doc = doc_new(a);
    deon_ctx ctx = ctx_new(a);
    if (setjmp(ctx.jmp)) { fill_error(doc, &ctx); return doc; }
    doc->root = json_to_value(&ctx, source, len, span_head(source_name ? source_name : "<json>"));
    doc->ok = true;
    return doc;
}

static char *dir_of_url(const char *link) {
    static char buf[2048];
    snprintf(buf, sizeof(buf), "%s", link);
    char *slash = strrchr(buf, '/');
    if (slash) *slash = '\0';
    return buf;
}

deon_document *deon_parse_link(const char *link, const deon_options *options) {
    deon_options opts;
    if (options) opts = *options; else memset(&opts, 0, sizeof(opts));

    arena *a = arena_new();
    deon_document *doc = doc_new(a);
    deon_ctx ctx = ctx_new(a);
    if (setjmp(ctx.jmp)) { fill_error(doc, &ctx); return doc; }

    if (!opts.allow_network) {
        char msg[1024];
        snprintf(msg, sizeof(msg), "'%s' was not fetched: network access is not allowed.", link);
        deon_fail(&ctx, DEON_CAPABILITY_DENIED, msg, span_head(link));
    }

    deon_str body = http_get(&ctx, link, "link", opts.token, span_head(link));

    opts.source_name = link;
    opts.filebase = arena_str_cstr(a, dir_of_url(link)).data;
    parse_into(doc, &ctx, body.data, body.len, &opts);
    return doc;
}

char *deon_read_file(const char *path, size_t *out_len, deon_code *error) {
    FILE *f = fopen(path, "rb");
    if (!f) { if (error) *error = DEON_RESOURCE_IO; return NULL; }
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); if (error) *error = DEON_RESOURCE_IO; return NULL; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); if (error) *error = DEON_RESOURCE_IO; return NULL; }
    rewind(f);
    char *buf = malloc((size_t)sz + 1);
    size_t got = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[got] = '\0';
    if (out_len) *out_len = got;
    if (error) *error = DEON_OK;
    return buf;
}

bool deon_document_ok(const deon_document *document) { return document && document->ok; }

const deon_error *deon_document_error(const deon_document *document) {
    return (document && !document->ok) ? &document->error : NULL;
}

deon_value *deon_document_root(const deon_document *document) {
    return (document && document->ok) ? document->root : NULL;
}

void deon_document_free(deon_document *document) {
    if (document) arena_free(document->a);
}
/* #endregion */

/* #region syntactic queries */
static const char *node_kind_name(const node *n) {
    switch (n->kind) {
        case NODE_MAP:       return "map";
        case NODE_LIST:      return "list";
        case NODE_STRUCTURE: return "structure";
        case NODE_LINK:      return "link";
        case NODE_CALL:      return "call";
        default:             return "scalar";
    }
}

static int cmp_deon_str(const void *pa, const void *pb) {
    const deon_str *a = pa, *b = pb;
    size_t n = a->len < b->len ? a->len : b->len;
    int c = memcmp(a->data, b->data, n);
    if (c != 0) return c;
    return a->len < b->len ? -1 : a->len > b->len ? 1 : 0;
}

deon_document *deon_entities(const char *source, size_t len, const char *source_name,
                             const deon_entity **out, size_t *out_len) {
    *out = NULL;
    *out_len = 0;
    arena *a = arena_new();
    deon_document *doc = doc_new(a);
    deon_ctx ctx = ctx_new(a);
    if (setjmp(ctx.jmp)) { fill_error(doc, &ctx); return doc; }

    document_ast *ast = parse_document(&ctx, source, len, source_name ? source_name : "<memory>");
    deon_entity *ents = arena_alloc(a, (ast->decls_len + 1) * sizeof(deon_entity));
    size_t k = 0;
    for (size_t i = 0; i < ast->decls_len; i++) {
        declaration *d = &ast->decls[i];
        ents[k].name = d->name;
        if (d->kind != DECL_LEAFLINK) {
            ents[k].parameters = NULL;
            ents[k].parameters_len = 0;
            ents[k].kind = "resource";
        } else {
            deon_str *names;
            size_t names_len;
            interpolation_names(d->value, a, &names, &names_len);
            if (names_len > 1) qsort(names, names_len, sizeof(deon_str), cmp_deon_str);
            ents[k].parameters = names;
            ents[k].parameters_len = names_len;
            ents[k].kind = node_kind_name(d->value);
        }
        k++;
    }
    doc->ok = true;
    doc->entities = ents;
    doc->entities_len = k;
    *out = ents;
    *out_len = k;
    return doc;
}

deon_document *deon_lint_document(const char *source, size_t len, const char *source_name,
                                  const deon_diagnostic **out, size_t *out_len) {
    *out = NULL;
    *out_len = 0;
    arena *a = arena_new();
    deon_document *doc = doc_new(a);
    deon_ctx ctx = ctx_new(a);
    if (setjmp(ctx.jmp)) { fill_error(doc, &ctx); return doc; }

    document_ast *ast = parse_document(&ctx, source, len, source_name ? source_name : "<memory>");
    deon_diagnostic *lints;
    size_t lints_len;
    lint_document(&ctx, ast, &lints, &lints_len);
    doc->ok = true;
    doc->lint = lints;
    doc->lint_len = lints_len;
    *out = lints;
    *out_len = lints_len;
    return doc;
}
/* #endregion */

/* #region writing and typing */
deon_stringify_options deon_default_stringify_options(void) {
    deon_stringify_options o;
    memset(&o, 0, sizeof(o));
    o.readable = true;
    o.indentation = 4;
    o.leaflink_level = 1;
    o.leaflink_shortening = true;
    return o;
}

char *deon_stringify(const deon_value *value, const deon_stringify_options *options, size_t *out_len) {
    deon_stringify_options o = options ? *options : deon_default_stringify_options();
    return stringify_value(value, &o, out_len);
}

char *deon_canonical(const deon_value *value, size_t *out_len) {
    deon_stringify_options o = deon_default_stringify_options();
    o.canonical = true;
    o.readable = true;
    o.indentation = 4;
    return stringify_value(value, &o, out_len);
}

deon_value *deon_typed(deon_document *document, const deon_value *value) {
    return type_value(document->a, value);
}
/* #endregion */
