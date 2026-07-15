#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "../deon/deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The cross-implementation harness adapter (spec/harness/README.md). A filter: newline-delimited JSON
 * in, newline-delimited JSON out. Every value in a request and a response is a string, so the request
 * itself parses with the implementation's own JSON reader and no third-party decoder is needed. */

/* #region a growable byte buffer */
typedef struct { char *data; size_t len, cap; } buf;
static void bgrow(buf *b, size_t extra) {
    if (b->len + extra <= b->cap) return;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->len + extra) cap *= 2;
    b->data = realloc(b->data, cap);
    b->cap = cap;
}
static void bputc(buf *b, char c) { bgrow(b, 1); b->data[b->len++] = c; }
static void bput(buf *b, const char *s, size_t n) { bgrow(b, n); memcpy(b->data + b->len, s, n); b->len += n; }
static void bputs(buf *b, const char *s) { bput(b, s, strlen(s)); }
/* #endregion */

/* #region JSON output */
static void json_string(buf *b, const char *s, size_t len) {
    bputc(b, '"');
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        switch (c) {
            case '"':  bputs(b, "\\\""); break;
            case '\\': bputs(b, "\\\\"); break;
            case '\n': bputs(b, "\\n"); break;
            case '\r': bputs(b, "\\r"); break;
            case '\t': bputs(b, "\\t"); break;
            case '\b': bputs(b, "\\b"); break;
            case '\f': bputs(b, "\\f"); break;
            default:
                if (c < 0x20) { char u[8]; snprintf(u, sizeof(u), "\\u%04x", c); bputs(b, u); }
                else bputc(b, (char)c);
        }
    }
    bputc(b, '"');
}

/* marshal a value as compact JSON — the harness re-parses and compares structures, so whitespace is
 * this adapter's own business, but a Deon map's write order is preserved and typed booleans and numbers
 * are written as JSON booleans and numbers. */
static void marshal(buf *b, const deon_value *v) {
    switch (v->kind) {
        case DEON_STRING: json_string(b, v->as.string.data, v->as.string.len); break;
        case DEON_BOOL:   bputs(b, v->as.boolean ? "true" : "false"); break;
        case DEON_NUMBER: {
            double d = v->as.number;
            char num[40];
            if (d == (double)(long long)d) snprintf(num, sizeof(num), "%lld", (long long)d);
            else snprintf(num, sizeof(num), "%.17g", d);
            bputs(b, num);
            break;
        }
        case DEON_LIST:
            bputc(b, '[');
            for (size_t i = 0; i < v->as.list.len; i++) { if (i) bputc(b, ','); marshal(b, v->as.list.items[i]); }
            bputc(b, ']');
            break;
        case DEON_MAP:
            bputc(b, '{');
            for (size_t i = 0; i < v->as.map.len; i++) {
                if (i) bputc(b, ',');
                json_string(b, v->as.map.keys[i].data, v->as.map.keys[i].len);
                bputc(b, ':');
                marshal(b, v->as.map.values[i]);
            }
            bputc(b, '}');
            break;
    }
}
/* #endregion */

/* #region request field access */
static const char *field_str(const deon_value *req, const char *key, const char *fallback) {
    deon_value *v = deon_map_get(req, key);
    if (v && v->kind == DEON_STRING) return v->as.string.data;
    return fallback;
}

static deon_pair *pairs_of(const deon_value *req, const char *key, size_t *out_len) {
    deon_value *m = deon_map_get(req, key);
    if (!m || m->kind != DEON_MAP || m->as.map.len == 0) { *out_len = 0; return NULL; }
    deon_pair *p = malloc(m->as.map.len * sizeof(deon_pair));
    for (size_t i = 0; i < m->as.map.len; i++) {
        p[i].key = m->as.map.keys[i].data;
        deon_value *val = m->as.map.values[i];
        p[i].value = val->kind == DEON_STRING ? val->as.string.data : "";
    }
    *out_len = m->as.map.len;
    return p;
}
/* #endregion */

static deon_stringify_options stringify_options_of(const deon_value *req) {
    deon_stringify_options o = deon_default_stringify_options();
    deon_value *m = deon_map_get(req, "stringifyOptions");
    if (!m || m->kind != DEON_MAP) return o;
    struct { const char *key; bool *flag; } flags[] = {
        {"canonical", &o.canonical}, {"readable", &o.readable}, {"leaflinks", &o.leaflinks},
        {"leaflinkShortening", &o.leaflink_shortening}, {"generatedHeader", &o.generated_header},
        {"generatedComments", &o.generated_comments},
    };
    for (size_t i = 0; i < sizeof(flags) / sizeof(flags[0]); i++) {
        deon_value *v = deon_map_get(m, flags[i].key);
        if (v && v->kind == DEON_STRING) *flags[i].flag = strcmp(v->as.string.data, "true") == 0;
    }
    deon_value *ind = deon_map_get(m, "indentation");
    if (ind && ind->kind == DEON_STRING) o.indentation = atoi(ind->as.string.data);
    deon_value *lvl = deon_map_get(m, "leaflinkLevel");
    if (lvl && lvl->kind == DEON_STRING) o.leaflink_level = atoi(lvl->as.string.data);
    return o;
}

static deon_options options_of(const deon_value *req, deon_pair **owned, size_t owned_cap, size_t *owned_n,
                               const char ***files_owned) {
    deon_options o;
    memset(&o, 0, sizeof(o));
    o.source_name = field_str(req, "sourceName", "<memory>");
    o.filebase = field_str(req, "filebase", "");
    o.allow_filesystem = strcmp(field_str(req, "allowFilesystem", "false"), "true") == 0;
    o.allow_network = strcmp(field_str(req, "allowNetwork", "false"), "true") == 0;

    size_t n = 0;
    o.resources = owned[n] = pairs_of(req, "files", &o.resources_len); (void)owned_cap; n++;
    o.absolute_paths = owned[n] = pairs_of(req, "absolutePaths", &o.absolute_paths_len); n++;
    o.environment = owned[n] = pairs_of(req, "environment", &o.environment_len); n++;
    o.datasign_map = owned[n] = pairs_of(req, "datasignMap", &o.datasign_map_len); n++;
    *owned_n = n;

    deon_value *files = deon_map_get(req, "datasignFiles");
    if (files && files->kind == DEON_LIST && files->as.list.len > 0) {
        const char **arr = malloc(files->as.list.len * sizeof(char *));
        for (size_t i = 0; i < files->as.list.len; i++)
            arr[i] = files->as.list.items[i]->kind == DEON_STRING ? files->as.list.items[i]->as.string.data : "";
        o.datasign_files = arr;
        o.datasign_files_len = files->as.list.len;
        *files_owned = arr;
    } else {
        *files_owned = NULL;
    }
    return o;
}

static void answer_ok(buf *out, const char *id, const char *result, size_t result_len) {
    bputs(out, "{\"id\":");
    json_string(out, id, strlen(id));
    bputs(out, ",\"ok\":\"true\",\"result\":");
    json_string(out, result, result_len);
    bputc(out, '}');
}

static void answer_error(buf *out, const char *id, const deon_error *e) {
    deon_span span = e->diagnostics_len ? e->diagnostics[0].span : (deon_span){0};
    char line[16], col[16];
    snprintf(line, sizeof(line), "%d", span.line);
    snprintf(col, sizeof(col), "%d", span.column);
    bputs(out, "{\"id\":");
    json_string(out, id, strlen(id));
    bputs(out, ",\"ok\":\"false\",\"code\":");
    json_string(out, deon_code_name(e->code), strlen(deon_code_name(e->code)));
    bputs(out, ",\"line\":");
    json_string(out, line, strlen(line));
    bputs(out, ",\"column\":");
    json_string(out, col, strlen(col));
    bputc(out, '}');
}

/* A writer reported a bare code (a host-built value that nests too deep) rather than a document error
 * with a span, so the position is 0:0. The code is normative; the position is not (diagnostics.md). */
static void answer_error_code(buf *out, const char *id, deon_code code) {
    bputs(out, "{\"id\":");
    json_string(out, id, strlen(id));
    bputs(out, ",\"ok\":\"false\",\"code\":");
    json_string(out, deon_code_name(code), strlen(deon_code_name(code)));
    bputs(out, ",\"line\":\"0\",\"column\":\"0\"}");
}

static void perform(const deon_value *req, const char *id, buf *out) {
    const char *op = field_str(req, "op", "");
    deon_value *sv = deon_map_get(req, "source");
    const char *source = sv && sv->kind == DEON_STRING ? sv->as.string.data : "";
    size_t source_len = sv && sv->kind == DEON_STRING ? sv->as.string.len : 0;
    const char *source_name = field_str(req, "sourceName", "<memory>");

    /* entities and lint reach nothing and need no capability */
    if (strcmp(op, "entities") == 0) {
        const deon_entity *ents;
        size_t n;
        deon_document *doc = deon_entities(source, source_len, source_name, &ents, &n);
        if (!deon_document_ok(doc)) { answer_error(out, id, deon_document_error(doc)); deon_document_free(doc); return; }
        buf j = {0};
        bputc(&j, '[');
        for (size_t i = 0; i < n; i++) {
            if (i) bputc(&j, ',');
            bputs(&j, "{\"name\":");
            json_string(&j, ents[i].name.data, ents[i].name.len);
            bputs(&j, ",\"parameters\":[");
            for (size_t p = 0; p < ents[i].parameters_len; p++) {
                if (p) bputc(&j, ',');
                json_string(&j, ents[i].parameters[p].data, ents[i].parameters[p].len);
            }
            bputs(&j, "],\"kind\":");
            json_string(&j, ents[i].kind, strlen(ents[i].kind));
            bputc(&j, '}');
        }
        bputc(&j, ']');
        answer_ok(out, id, j.data, j.len);
        free(j.data);
        deon_document_free(doc);
        return;
    }
    if (strcmp(op, "lint") == 0) {
        const deon_diagnostic *lints;
        size_t n;
        deon_document *doc = deon_lint_document(source, source_len, source_name, &lints, &n);
        buf j = {0};
        bputc(&j, '[');
        for (size_t i = 0; i < n; i++) {
            if (i) bputc(&j, ',');
            char line[16], col[16];
            snprintf(line, sizeof(line), "%d", lints[i].span.line);
            snprintf(col, sizeof(col), "%d", lints[i].span.column);
            bputs(&j, "{\"code\":");
            json_string(&j, deon_code_name(lints[i].code), strlen(deon_code_name(lints[i].code)));
            bputs(&j, ",\"line\":");
            json_string(&j, line, strlen(line));
            bputs(&j, ",\"column\":");
            json_string(&j, col, strlen(col));
            bputc(&j, '}');
        }
        bputc(&j, ']');
        answer_ok(out, id, j.data, j.len);
        free(j.data);
        deon_document_free(doc);
        return;
    }

    deon_pair *owned[8];
    size_t owned_n = 0;
    const char **files_owned = NULL;
    deon_options o = options_of(req, owned, 8, &owned_n, &files_owned);

    deon_document *doc = deon_parse_with(source, source_len, &o);
    if (!deon_document_ok(doc)) {
        answer_error(out, id, deon_document_error(doc));
    } else {
        deon_value *root = deon_document_root(doc);
        if (strcmp(op, "canonical") == 0) {
            size_t n; deon_code ec = DEON_OK; char *s = deon_canonical(root, &n, &ec);
            if (!s) answer_error_code(out, id, ec);
            else { answer_ok(out, id, s, n); free(s); }
        } else if (strcmp(op, "stringify") == 0) {
            deon_stringify_options so = stringify_options_of(req);
            size_t n; deon_code ec = DEON_OK; char *s = deon_stringify(root, &so, &n, &ec);
            if (!s) answer_error_code(out, id, ec);
            else { answer_ok(out, id, s, n); free(s); }
        } else if (strcmp(op, "typed") == 0) {
            deon_code ec = DEON_OK;
            deon_value *t = deon_typed(doc, root, &ec);
            if (!t) answer_error_code(out, id, ec);
            else {
                buf j = {0};
                marshal(&j, t);
                answer_ok(out, id, j.data, j.len);
                free(j.data);
            }
        } else if (strcmp(op, "datasign") == 0) {
            buf j = {0};
            marshal(&j, root); /* parse_with already applied the contracts */
            answer_ok(out, id, j.data, j.len);
            free(j.data);
        } else {
            bputs(out, "{\"id\":");
            json_string(out, id, strlen(id));
            bputs(out, ",\"ok\":\"false\",\"code\":\"HOST_PANIC\",\"line\":\"0\",\"column\":\"0\"}");
        }
    }
    deon_document_free(doc);
    for (size_t i = 0; i < owned_n; i++) free(owned[i]);
    free(files_owned);
}

int main(void) {
    char *line = NULL;
    size_t cap = 0;
    ssize_t got;
    while ((got = getline(&line, &cap, stdin)) != -1) {
        size_t len = (size_t)got;
        while (len && (line[len - 1] == '\n' || line[len - 1] == '\r')) len--;
        if (len == 0) continue;

        deon_document *req = deon_read_json(line, len, "<request>");
        if (!deon_document_ok(req)) { deon_document_free(req); continue; }
        deon_value *root = deon_document_root(req);
        if (!root || root->kind != DEON_MAP) { deon_document_free(req); continue; }

        const char *id = field_str(root, "id", "");
        buf out = {0};
        perform(root, id, &out);
        fwrite(out.data, 1, out.len, stdout);
        fputc('\n', stdout);
        fflush(stdout);
        free(out.data);
        deon_document_free(req);
    }
    free(line);
    return 0;
}
