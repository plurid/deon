#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* The normative conformance suite (specification 15). An implementation conforms to Deon 1.0 only when
 * it passes every required fixture in spec/conformance/cases.json. The fixtures are language-neutral and
 * shared by every implementation, read from the repository rather than copied. This runner carries its
 * own typed JSON reader — unlike the library's, which flattens every scalar to a string — because the
 * `typed` and `datasign` fixtures assert that a boolean is a boolean and a number is a number. */

#define MANIFEST "../../spec/conformance/cases.json"

/* #region a typed JSON value */
typedef enum { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ } jkind;
typedef struct jnode jnode;
struct jnode {
    jkind kind;
    bool b;
    double num;
    char *str; size_t slen;
    jnode **items; size_t len;
    char **keys; jnode **vals; size_t olen;
};

typedef struct { const char *s; const char *end; bool ok; } jp;

static jnode *jval(jp *p);

static void jws(jp *p) { while (p->s < p->end && (*p->s == ' ' || *p->s == '\t' || *p->s == '\n' || *p->s == '\r')) p->s++; }

static int jhex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static void put_rune(char **b, size_t *len, size_t *cap, uint32_t r) {
    if (*len + 4 > *cap) { *cap = *cap ? *cap * 2 : 16; *b = realloc(*b, *cap); }
    if (r < 0x80) (*b)[(*len)++] = (char)r;
    else if (r < 0x800) { (*b)[(*len)++] = (char)(0xC0 | (r >> 6)); (*b)[(*len)++] = (char)(0x80 | (r & 0x3F)); }
    else if (r < 0x10000) { (*b)[(*len)++] = (char)(0xE0 | (r >> 12)); (*b)[(*len)++] = (char)(0x80 | ((r >> 6) & 0x3F)); (*b)[(*len)++] = (char)(0x80 | (r & 0x3F)); }
    else { (*b)[(*len)++] = (char)(0xF0 | (r >> 18)); (*b)[(*len)++] = (char)(0x80 | ((r >> 12) & 0x3F)); (*b)[(*len)++] = (char)(0x80 | ((r >> 6) & 0x3F)); (*b)[(*len)++] = (char)(0x80 | (r & 0x3F)); }
}

static char *jstr(jp *p, size_t *out_len) {
    if (p->s >= p->end || *p->s != '"') { p->ok = false; return NULL; }
    p->s++;
    char *b = NULL; size_t len = 0, cap = 0;
    while (p->s < p->end) {
        char c = *p->s++;
        if (c == '"') { b = realloc(b, len + 1); b[len] = '\0'; if (out_len) *out_len = len; return b; }
        if (c == '\\') {
            if (p->s >= p->end) break;
            char e = *p->s++;
            uint32_t r;
            switch (e) {
                case '"': r = '"'; break;
                case '\\': r = '\\'; break;
                case '/': r = '/'; break;
                case 'b': r = '\b'; break;
                case 'f': r = '\f'; break;
                case 'n': r = '\n'; break;
                case 'r': r = '\r'; break;
                case 't': r = '\t'; break;
                case 'u': {
                    if (p->end - p->s < 4) { p->ok = false; return NULL; }
                    int h = 0;
                    for (int i = 0; i < 4; i++) { int v = jhex(p->s[i]); if (v < 0) { p->ok = false; return NULL; } h = (h << 4) | v; }
                    p->s += 4;
                    r = (uint32_t)h;
                    if (r >= 0xD800 && r <= 0xDBFF && p->end - p->s >= 6 && p->s[0] == '\\' && p->s[1] == 'u') {
                        int lo = 0; bool ok = true;
                        for (int i = 0; i < 4; i++) { int v = jhex(p->s[2 + i]); if (v < 0) { ok = false; break; } lo = (lo << 4) | v; }
                        if (ok && lo >= 0xDC00 && lo <= 0xDFFF) { r = 0x10000 + ((r - 0xD800) << 10) + (lo - 0xDC00); p->s += 6; }
                    }
                    break;
                }
                default: p->ok = false; return NULL;
            }
            put_rune(&b, &len, &cap, r);
        } else {
            if (len + 1 > cap) { cap = cap ? cap * 2 : 16; b = realloc(b, cap); }
            b[len++] = c;
        }
    }
    p->ok = false;
    return NULL;
}

static jnode *jval(jp *p) {
    jws(p);
    if (p->s >= p->end) { p->ok = false; return NULL; }
    jnode *n = calloc(1, sizeof(jnode));
    char c = *p->s;
    if (c == '{') {
        p->s++;
        n->kind = J_OBJ;
        size_t cap = 0;
        jws(p);
        if (p->s < p->end && *p->s == '}') { p->s++; return n; }
        for (;;) {
            jws(p);
            size_t klen;
            char *key = jstr(p, &klen);
            if (!p->ok) return n;
            jws(p);
            if (p->s >= p->end || *p->s != ':') { p->ok = false; return n; }
            p->s++;
            jnode *v = jval(p);
            if (!p->ok) return n;
            if (n->olen == cap) { cap = cap ? cap * 2 : 8; n->keys = realloc(n->keys, cap * sizeof(char *)); n->vals = realloc(n->vals, cap * sizeof(jnode *)); }
            n->keys[n->olen] = key; n->vals[n->olen] = v; n->olen++;
            jws(p);
            if (p->s < p->end && *p->s == ',') { p->s++; continue; }
            if (p->s < p->end && *p->s == '}') { p->s++; break; }
            p->ok = false; return n;
        }
        return n;
    }
    if (c == '[') {
        p->s++;
        n->kind = J_ARR;
        size_t cap = 0;
        jws(p);
        if (p->s < p->end && *p->s == ']') { p->s++; return n; }
        for (;;) {
            jnode *v = jval(p);
            if (!p->ok) return n;
            if (n->len == cap) { cap = cap ? cap * 2 : 8; n->items = realloc(n->items, cap * sizeof(jnode *)); }
            n->items[n->len++] = v;
            jws(p);
            if (p->s < p->end && *p->s == ',') { p->s++; continue; }
            if (p->s < p->end && *p->s == ']') { p->s++; break; }
            p->ok = false; return n;
        }
        return n;
    }
    if (c == '"') { n->kind = J_STR; n->str = jstr(p, &n->slen); return n; }
    if (c == 't') { if (p->end - p->s >= 4 && memcmp(p->s, "true", 4) == 0) { p->s += 4; n->kind = J_BOOL; n->b = true; return n; } p->ok = false; return n; }
    if (c == 'f') { if (p->end - p->s >= 5 && memcmp(p->s, "false", 5) == 0) { p->s += 5; n->kind = J_BOOL; n->b = false; return n; } p->ok = false; return n; }
    if (c == 'n') { if (p->end - p->s >= 4 && memcmp(p->s, "null", 4) == 0) { p->s += 4; n->kind = J_NULL; return n; } p->ok = false; return n; }
    /* number */
    const char *start = p->s;
    if (*p->s == '-') p->s++;
    while (p->s < p->end && ((*p->s >= '0' && *p->s <= '9') || *p->s == '.' || *p->s == 'e' || *p->s == 'E' || *p->s == '+' || *p->s == '-')) p->s++;
    if (p->s == start) { p->ok = false; return n; }
    char tmp[64];
    size_t l = (size_t)(p->s - start);
    if (l >= sizeof(tmp)) l = sizeof(tmp) - 1;
    memcpy(tmp, start, l); tmp[l] = '\0';
    n->kind = J_NUM; n->num = strtod(tmp, NULL);
    return n;
}

static jnode *jparse(const char *s, size_t len) {
    jp p = { s, s + len, true };
    jnode *n = jval(&p);
    return p.ok ? n : NULL;
}

static jnode *jget(jnode *obj, const char *key) {
    if (!obj || obj->kind != J_OBJ) return NULL;
    for (size_t i = 0; i < obj->olen; i++) if (strcmp(obj->keys[i], key) == 0) return obj->vals[i];
    return NULL;
}
/* #endregion */

/* #region matching a deon value against typed JSON */
static bool deon_matches(const deon_value *v, jnode *w) {
    switch (w->kind) {
        case J_STR:  return v->kind == DEON_STRING && v->as.string.len == w->slen && memcmp(v->as.string.data, w->str, w->slen) == 0;
        case J_ARR:
            if (v->kind != DEON_LIST || v->as.list.len != w->len) return false;
            for (size_t i = 0; i < w->len; i++) if (!deon_matches(v->as.list.items[i], w->items[i])) return false;
            return true;
        case J_OBJ:
            if (v->kind != DEON_MAP || v->as.map.len != w->olen) return false;
            for (size_t i = 0; i < w->olen; i++) {
                deon_value *m = deon_map_get(v, w->keys[i]);
                if (!m || !deon_matches(m, w->vals[i])) return false;
            }
            return true;
        default: return false;
    }
}

static bool typed_matches(const deon_value *v, jnode *w) {
    switch (w->kind) {
        case J_BOOL: return v->kind == DEON_BOOL && v->as.boolean == w->b;
        case J_NUM:
            if (v->kind == DEON_BOOL) return false;
            if (v->kind != DEON_NUMBER) return false;
            return v->as.number == w->num || fabs(v->as.number - w->num) < 1e-9;
        case J_STR:  return v->kind == DEON_STRING && v->as.string.len == w->slen && memcmp(v->as.string.data, w->str, w->slen) == 0;
        case J_ARR:
            if (v->kind != DEON_LIST || v->as.list.len != w->len) return false;
            for (size_t i = 0; i < w->len; i++) if (!typed_matches(v->as.list.items[i], w->items[i])) return false;
            return true;
        case J_OBJ:
            if (v->kind != DEON_MAP || v->as.map.len != w->olen) return false;
            for (size_t i = 0; i < w->olen; i++) {
                deon_value *m = deon_map_get(v, w->keys[i]);
                if (!m || !typed_matches(m, w->vals[i])) return false;
            }
            return true;
        default: return v->kind == DEON_STRING; /* J_NULL never appears in typed fixtures */
    }
}
/* #endregion */

/* #region options and counters */
typedef struct { int expected, errored, position, canonical, stringify, typed, lint, datasign; } checked;

static const char *jstr_of(jnode *n) { return (n && n->kind == J_STR) ? n->str : NULL; }

typedef struct {
    deon_pair *res; size_t res_len;
    deon_pair *env; size_t env_len;
    deon_pair *abs; size_t abs_len;
    deon_pair *dsmap; size_t dsmap_len;
    const char **dsfiles; size_t dsfiles_len;
    char filebase[1024];
} opt_scratch;

static deon_pair *pairs_from(jnode *obj, size_t *out_len) {
    if (!obj || obj->kind != J_OBJ || obj->olen == 0) { *out_len = 0; return NULL; }
    deon_pair *p = malloc(obj->olen * sizeof(deon_pair));
    for (size_t i = 0; i < obj->olen; i++) { p[i].key = obj->keys[i]; p[i].value = jstr_of(obj->vals[i]) ? obj->vals[i]->str : ""; }
    *out_len = obj->olen;
    return p;
}

static deon_options options_of(jnode *c, opt_scratch *s) {
    deon_options o;
    memset(&o, 0, sizeof(o));
    memset(s, 0, sizeof(*s));

    jnode *files = jget(c, "files");
    s->res = pairs_from(files, &s->res_len);
    o.resources = s->res; o.resources_len = s->res_len;

    const char *file = jstr_of(jget(c, "file"));
    if (file) {
        o.source_name = file;
        snprintf(s->filebase, sizeof(s->filebase), "%s", file);
        char *slash = strrchr(s->filebase, '/');
        if (slash) *slash = '\0'; else snprintf(s->filebase, sizeof(s->filebase), ".");
        o.filebase = s->filebase;
    }

    s->env = pairs_from(jget(c, "environment"), &s->env_len);
    o.environment = s->env; o.environment_len = s->env_len;

    jnode *ds = jget(c, "datasign");
    if (ds) {
        s->dsmap = pairs_from(jget(ds, "map"), &s->dsmap_len);
        o.datasign_map = s->dsmap; o.datasign_map_len = s->dsmap_len;
        jnode *dsf = jget(ds, "files");
        if (dsf && dsf->kind == J_ARR && dsf->len) {
            s->dsfiles = malloc(dsf->len * sizeof(char *));
            for (size_t i = 0; i < dsf->len; i++) s->dsfiles[i] = jstr_of(dsf->items[i]) ? dsf->items[i]->str : "";
            o.datasign_files = s->dsfiles; o.datasign_files_len = dsf->len;
        }
    }

    jnode *opts = jget(c, "options");
    if (opts && opts->kind == J_OBJ) {
        jnode *ap = jget(opts, "absolutePaths");
        if (ap) { s->abs = pairs_from(ap, &s->abs_len); o.absolute_paths = s->abs; o.absolute_paths_len = s->abs_len; }
        jnode *af = jget(opts, "allowFilesystem");
        if (af && af->kind == J_BOOL) o.allow_filesystem = af->b;
        jnode *an = jget(opts, "allowNetwork");
        if (an && an->kind == J_BOOL) o.allow_network = an->b;
        const char *sn = jstr_of(jget(opts, "sourceName"));
        if (sn) o.source_name = sn;
        const char *fb = jstr_of(jget(opts, "filebase"));
        if (fb) o.filebase = fb;
    }
    return o;
}

static void free_scratch(opt_scratch *s) {
    free(s->res); free(s->env); free(s->abs); free(s->dsmap); free((void *)s->dsfiles);
}

static const char *source_of(jnode *c) {
    const char *file = jstr_of(jget(c, "file"));
    if (file) {
        jnode *files = jget(c, "files");
        jnode *f = jget(files, file);
        return jstr_of(f) ? f->str : "";
    }
    const char *src = jstr_of(jget(c, "source"));
    return src ? src : "";
}
static size_t source_len_of(jnode *c) {
    const char *file = jstr_of(jget(c, "file"));
    if (file) { jnode *f = jget(jget(c, "files"), file); return f && f->kind == J_STR ? f->slen : 0; }
    jnode *s = jget(c, "source");
    return s && s->kind == J_STR ? s->slen : 0;
}
/* #endregion */

static int failures = 0;
static void fail(const char *id, const char *fmt, const char *a, const char *b) {
    fprintf(stderr, "FAIL %s: ", id);
    fprintf(stderr, fmt, a, b);
    fprintf(stderr, "\n");
    failures++;
}

static bool match_error(jnode *c, deon_document *doc, const char *id, checked *did) {
    const char *want = jstr_of(jget(c, "error"));
    if (deon_document_ok(doc)) { fail(id, "expected %s, but it evaluated", want, ""); return false; }
    const deon_error *e = deon_document_error(doc);
    const char *got = deon_code_name(e->code);
    if (strcmp(got, want) != 0) { fail(id, "expected %s, got %s", want, got); return false; }
    did->errored++;
    jnode *pos = jget(c, "position");
    if (pos && pos->kind == J_OBJ) {
        int line = (int)(jget(pos, "line") ? jget(pos, "line")->num : 0);
        int col = (int)(jget(pos, "column") ? jget(pos, "column")->num : 0);
        deon_span span = e->diagnostics[0].span;
        if (span.line != line || span.column != col) {
            char g[64], w[64];
            snprintf(w, sizeof(w), "%d:%d", line, col);
            snprintf(g, sizeof(g), "%d:%d", span.line, span.column);
            fail(id, "position: expected %s, got %s", w, g);
            return false;
        }
        did->position++;
    }
    return true;
}

static deon_stringify_options stringify_options_of(jnode *opts) {
    deon_stringify_options o = deon_default_stringify_options();
    if (!opts || opts->kind != J_OBJ) return o;
    struct { const char *k; bool *f; } flags[] = {
        {"canonical", &o.canonical}, {"readable", &o.readable}, {"leaflinks", &o.leaflinks},
        {"leaflinkShortening", &o.leaflink_shortening}, {"generatedHeader", &o.generated_header},
        {"generatedComments", &o.generated_comments},
    };
    for (size_t i = 0; i < sizeof(flags) / sizeof(flags[0]); i++) {
        jnode *v = jget(opts, flags[i].k);
        if (v && v->kind == J_BOOL) *flags[i].f = v->b;
    }
    jnode *ind = jget(opts, "indentation");
    if (ind && ind->kind == J_NUM) o.indentation = (int)ind->num;
    jnode *lvl = jget(opts, "leaflinkLevel");
    if (lvl && lvl->kind == J_NUM) o.leaflink_level = (int)lvl->num;
    return o;
}

static void run_case(jnode *c, checked *did) {
    const char *id = jstr_of(jget(c, "id"));
    const char *source = source_of(c);
    size_t slen = source_len_of(c);
    opt_scratch s;
    deon_options o = options_of(c, &s);

    jnode *datasign = jget(c, "datasign");
    const char *error = jstr_of(jget(c, "error"));

    if (datasign) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        if (error) {
            if (match_error(c, doc, id, did)) did->datasign++;
        } else {
            jnode *want = jget(datasign, "typed");
            if (!deon_document_ok(doc)) fail(id, "datasign: %s", deon_code_name(deon_document_error(doc)->code), "");
            else if (!want || !typed_matches(deon_document_root(doc), want)) fail(id, "datasign: value does not match", "", "");
            else did->datasign++;
        }
        deon_document_free(doc);
        free_scratch(&s);
        return;
    }

    if (error) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        match_error(c, doc, id, did);
        deon_document_free(doc);
        free_scratch(&s);
        return;
    }

    bool asserted = false;

    jnode *expected = jget(c, "expected");
    if (expected) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        if (!deon_document_ok(doc)) fail(id, "expected a value, got %s", deon_code_name(deon_document_error(doc)->code), "");
        else if (!deon_matches(deon_document_root(doc), expected)) fail(id, "value does not match expected", "", "");
        else { did->expected++; asserted = true; }
        deon_document_free(doc);
    }

    jnode *canonical = jget(c, "canonical");
    if (canonical && canonical->kind == J_STR) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        if (!deon_document_ok(doc)) fail(id, "canonical: %s", deon_code_name(deon_document_error(doc)->code), "");
        else {
            size_t n; char *got = deon_canonical(deon_document_root(doc), &n);
            if (n != canonical->slen || memcmp(got, canonical->str, n) != 0) fail(id, "canonical mismatch", "", "");
            else { did->canonical++; asserted = true; }
            free(got);
        }
        deon_document_free(doc);
    }

    jnode *stringify = jget(c, "stringify");
    if (stringify && stringify->kind == J_OBJ) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        if (!deon_document_ok(doc)) fail(id, "stringify: %s", deon_code_name(deon_document_error(doc)->code), "");
        else {
            deon_stringify_options so = stringify_options_of(jget(stringify, "options"));
            size_t n; char *got = deon_stringify(deon_document_root(doc), &so, &n);
            jnode *exp = jget(stringify, "expected");
            if (!exp || exp->kind != J_STR || n != exp->slen || memcmp(got, exp->str, n) != 0) fail(id, "stringify mismatch", "", "");
            else { did->stringify++; asserted = true; }
            free(got);
        }
        deon_document_free(doc);
    }

    jnode *typed = jget(c, "typed");
    if (typed) {
        deon_document *doc = deon_parse_with(source, slen, &o);
        if (!deon_document_ok(doc)) fail(id, "typed: %s", deon_code_name(deon_document_error(doc)->code), "");
        else if (!typed_matches(deon_typed(doc, deon_document_root(doc)), typed)) fail(id, "typed does not match", "", "");
        else { did->typed++; asserted = true; }
        deon_document_free(doc);
    }

    jnode *lint = jget(c, "lint");
    if (lint && lint->kind == J_ARR) {
        const char *src_name = o.source_name ? o.source_name : "<memory>";
        const deon_diagnostic *diags; size_t n;
        deon_document *doc = deon_lint_document(source, slen, src_name, &diags, &n);
        bool all = true;
        for (size_t i = 0; i < lint->len; i++) {
            const char *want = jstr_of(lint->items[i]);
            bool found = false;
            for (size_t j = 0; j < n; j++) if (strcmp(deon_code_name(diags[j].code), want) == 0) { found = true; break; }
            if (!found) { fail(id, "expected lint %s", want, ""); all = false; break; }
        }
        deon_document_free(doc);
        if (all) { did->lint++; asserted = true; }
    }

    if (!asserted) fail(id, "the fixture asserts nothing", "", "");
    free_scratch(&s);
}

/* the round-trip invariant of section 13: parse(canonical(v)) == v over every non-error case */
static void round_trip(jnode *c) {
    const char *id = jstr_of(jget(c, "id"));
    if (jget(c, "error") || jget(c, "feature")) return;
    opt_scratch s;
    deon_options o = options_of(c, &s);
    deon_document *doc = deon_parse_with(source_of(c), source_len_of(c), &o);
    if (!deon_document_ok(doc)) { deon_document_free(doc); free_scratch(&s); return; }
    size_t n; char *canon = deon_canonical(deon_document_root(doc), &n);
    deon_document *again = deon_parse(canon, n);
    if (!deon_document_ok(again)) fail(id, "canonical does not re-parse", "", "");
    else if (!deon_value_equal(deon_document_root(again), deon_document_root(doc))) fail(id, "parse(canonical(v)) != v", "", "");
    free(canon);
    deon_document_free(again);
    deon_document_free(doc);
    free_scratch(&s);
}

static void invariants(void) {
    /* a rewritten key stringifies at its final write position (section 5) */
    deon_document *d = deon_parse("{ a one\nb two\na three }", 23);
    size_t n; char *got = deon_stringify(deon_document_root(d), NULL, &n);
    const char *want = "{\n    b two\n    a three\n}\n";
    if (strcmp(got, want) != 0) fail("rewritten-key", "expected %s", want, "");
    free(got); deon_document_free(d);

    /* a column counts code points, not bytes */
    const char *src = "{\n    \xd0\xba\xd0\xbb\xd1\x8e\xd1\x87 value\n}\n";
    deon_document *e = deon_parse(src, strlen(src));
    if (deon_document_ok(e)) fail("column-code-points", "expected an error", "", "");
    else {
        deon_span span = deon_document_error(e)->diagnostics[0].span;
        if (span.line != 2 || span.column != 5) { char g[32]; snprintf(g, sizeof(g), "%d:%d", span.line, span.column); fail("column-code-points", "expected 2:5, got %s", g, ""); }
    }
    deon_document_free(e);
}

int main(void) {
    FILE *f = fopen(MANIFEST, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", MANIFEST); return 2; }
    fseek(f, 0, SEEK_END); long sz = ftell(f); rewind(f);
    char *raw = malloc((size_t)sz + 1);
    size_t got = fread(raw, 1, (size_t)sz, f);
    raw[got] = '\0';
    fclose(f);

    jnode *manifest = jparse(raw, got);
    if (!manifest) { fprintf(stderr, "cannot parse the manifest\n"); return 2; }
    jnode *cases = jget(manifest, "cases");
    if (!cases || cases->kind != J_ARR) { fprintf(stderr, "no cases in the manifest\n"); return 2; }

    /* datasign is the only optional feature this implementation offers; every other feature-tagged
     * fixture is filtered out, so the counters balance over whatever ran. */
    checked did = {0}, want = {0};
    int ran = 0;
    for (size_t i = 0; i < cases->len; i++) {
        jnode *c = cases->items[i];
        const char *feature = jstr_of(jget(c, "feature"));
        if (feature && strcmp(feature, "datasign") != 0) continue;
        ran++;

        if (jget(c, "expected")) want.expected++;
        if (jget(c, "error")) want.errored++;
        if (jget(c, "position")) want.position++;
        if (jget(c, "canonical")) want.canonical++;
        if (jget(c, "stringify")) want.stringify++;
        if (jget(c, "typed")) want.typed++;
        if (jget(c, "lint")) want.lint++;
        if (jget(c, "datasign")) want.datasign++;

        run_case(c, &did);
        round_trip(c);
    }

    invariants();

    /* the coverage counters must equal what the manifest declares, so a runner that silently ignored a
     * field would fail rather than show green */
    if (memcmp(&did, &want, sizeof(checked)) != 0) {
        fprintf(stderr, "coverage mismatch:\n  checked:  expected=%d errored=%d position=%d canonical=%d stringify=%d typed=%d lint=%d datasign=%d\n"
                        "  declared: expected=%d errored=%d position=%d canonical=%d stringify=%d typed=%d lint=%d datasign=%d\n",
                did.expected, did.errored, did.position, did.canonical, did.stringify, did.typed, did.lint, did.datasign,
                want.expected, want.errored, want.position, want.canonical, want.stringify, want.typed, want.lint, want.datasign);
        failures++;
    }

    if (failures == 0) { printf("all %d conformance cases passed (code and position)\n", ran); return 0; }
    fprintf(stderr, "\n%d failure(s) across %d cases\n", failures, ran);
    return 1;
}
