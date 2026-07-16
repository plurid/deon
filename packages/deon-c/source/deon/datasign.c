#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>

/* Typing a document against a declared contract (section 14.1). The conservative typer guesses from the
 * value and so refuses whenever a guess could be wrong; a datasign contract is the other half — it
 * supplies the intent the value cannot carry, so 007 becomes 7 exactly where a contract declared it a
 * number, and nowhere else. This is an adapter to the datasign format, whose rules are its own. */

#define DATASIGN_SOURCE "<datasign>"

typedef struct { char *name; char *declared; bool required; } ds_field;
typedef struct { char *name; ds_field *fields; size_t len, cap; } ds_entity;
typedef struct { ds_entity *e; size_t len, cap; } ds_sigs;

/* #region small string helpers */
static char *dup_range(const char *s, size_t len) {
    char *r = malloc(len + 1);
    memcpy(r, s, len);
    r[len] = '\0';
    return r;
}

static void trim_bounds(const char *s, size_t *start, size_t *end) {
    size_t a = *start, b = *end;
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\n' || s[a] == '\r' || s[a] == '\v' || s[a] == '\f')) a++;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\n' || s[b - 1] == '\r' || s[b - 1] == '\v' || s[b - 1] == '\f')) b--;
    *start = a; *end = b;
}

/* strip every '?' from a range and return a fresh trimmed string */
static char *strip_optional(const char *s, size_t start, size_t end) {
    trim_bounds(s, &start, &end);
    char *r = malloc(end - start + 1);
    size_t k = 0;
    for (size_t i = start; i < end; i++) if (s[i] != '?') r[k++] = s[i];
    r[k] = '\0';
    return r;
}

static char *arena_path(arena *a, const char *fmt, const char *base, const char *tail) {
    int need = snprintf(NULL, 0, fmt, base, tail);
    char *buf = arena_alloc(a, (size_t)need + 1);
    snprintf(buf, (size_t)need + 1, fmt, base, tail);
    return buf;
}
/* #endregion */

/* #region numbers — ECMAScript Number(string), which section 14.1 fixes as the grammar */
static bool ds_decimal(const char *s, size_t n) {
    size_t i = 0;
    if (i < n && (s[i] == '+' || s[i] == '-')) i++;
    bool mant = false;
    if (i < n && s[i] >= '0' && s[i] <= '9') {
        while (i < n && s[i] >= '0' && s[i] <= '9') i++;
        mant = true;
        if (i < n && s[i] == '.') { i++; while (i < n && s[i] >= '0' && s[i] <= '9') i++; }
    } else if (i < n && s[i] == '.') {
        i++;
        if (!(i < n && s[i] >= '0' && s[i] <= '9')) return false;
        while (i < n && s[i] >= '0' && s[i] <= '9') i++;
        mant = true;
    }
    if (!mant) return false;
    if (i < n && (s[i] == 'e' || s[i] == 'E')) {
        i++;
        if (i < n && (s[i] == '+' || s[i] == '-')) i++;
        if (!(i < n && s[i] >= '0' && s[i] <= '9')) return false;
        while (i < n && s[i] >= '0' && s[i] <= '9') i++;
    }
    return i == n;
}

static bool datasign_numeric(const char *text, double *out) {
    size_t start = 0, end = strlen(text);
    trim_bounds(text, &start, &end);
    if (start == end) return false;
    const char *t = text + start;
    size_t n = end - start;

    static const struct { const char *prefix; int base; } radixes[] = {
        {"0x", 16}, {"0X", 16}, {"0o", 8}, {"0O", 8}, {"0b", 2}, {"0B", 2}
    };
    for (size_t r = 0; r < 6; r++) {
        size_t pl = 2;
        if (n > pl && t[0] == radixes[r].prefix[0] && t[1] == radixes[r].prefix[1]) {
            char *rest = dup_range(t + pl, n - pl);
            char *stop = NULL;
            unsigned long long v = strtoull(rest, &stop, radixes[r].base);
            bool ok = *rest != '\0' && stop && *stop == '\0';
            free(rest);
            if (!ok) return false;
            *out = (double)v;
            return true;
        }
    }

    if (!ds_decimal(t, n)) return false;
    char *tmp = dup_range(t, n);
    char *stop = NULL;
    double v = strtod(tmp, &stop);
    bool ok = stop && *stop == '\0';
    free(tmp);
    if (!ok || !isfinite(v)) return false;
    *out = v;
    return true;
}
/* #endregion */

/* #region reading a contract */
static void sigs_add_entity(ds_sigs *s, char *name) {
    if (s->len == s->cap) {
        s->cap = s->cap ? s->cap * 2 : 8;
        s->e = realloc(s->e, s->cap * sizeof(ds_entity));
    }
    s->e[s->len].name = name;
    s->e[s->len].fields = NULL;
    s->e[s->len].len = 0;
    s->e[s->len].cap = 0;
    s->len++;
}

static void entity_add_field(ds_entity *e, char *name, char *declared, bool required) {
    if (e->len == e->cap) {
        e->cap = e->cap ? e->cap * 2 : 8;
        e->fields = realloc(e->fields, e->cap * sizeof(ds_field));
    }
    e->fields[e->len].name = name;
    e->fields[e->len].declared = declared;
    e->fields[e->len].required = required;
    e->len++;
}

static ds_entity *sigs_find(ds_sigs *s, const char *name) {
    for (size_t i = 0; i < s->len; i++) if (strcmp(s->e[i].name, name) == 0) return &s->e[i];
    return NULL;
}

/* match `^\s*data\s+(\w+)\s*\{`, returning the captured name (malloc'd) or NULL */
static char *match_entity(const char *line, size_t len) {
    size_t i = 0;
    while (i < len && (line[i] == ' ' || line[i] == '\t')) i++;
    if (len - i < 4 || memcmp(line + i, "data", 4) != 0) return NULL;
    i += 4;
    size_t ws = i;
    while (i < len && (line[i] == ' ' || line[i] == '\t')) i++;
    if (i == ws) return NULL; /* \s+ */
    size_t name_start = i;
    while (i < len && ((line[i] >= 'A' && line[i] <= 'Z') || (line[i] >= 'a' && line[i] <= 'z') ||
                       (line[i] >= '0' && line[i] <= '9') || line[i] == '_')) i++;
    if (i == name_start) return NULL; /* \w+ */
    size_t name_end = i;
    while (i < len && (line[i] == ' ' || line[i] == '\t')) i++;
    if (i >= len || line[i] != '{') return NULL;
    return dup_range(line + name_start, name_end - name_start);
}

static void parse_datasign(const char *source, size_t src_len, ds_sigs *sigs) {
    ds_entity *open = NULL;
    size_t i = 0;
    while (i <= src_len) {
        size_t ls = i;
        while (i < src_len && source[i] != '\n') i++;
        size_t le = i;
        i++; /* past the newline (or one past end) */
        if (ls > src_len) break;

        /* trimmed-left prefix rejection */
        size_t t = ls;
        while (t < le && (source[t] == ' ' || source[t] == '\t')) t++;
        if (le - t >= 2 && (memcmp(source + t, "//", 2) == 0 || memcmp(source + t, "/*", 2) == 0)) continue;
        if (t < le && (source[t] == '*' || source[t] == '@')) continue;

        /* value = line up to a `//` */
        size_t vend = le;
        for (size_t j = ls; j + 1 < le; j++) {
            if (source[j] == '/' && source[j + 1] == '/') { vend = j; break; }
        }
        size_t cs = ls, ce = vend;
        trim_bounds(source, &cs, &ce);
        if (cs == ce) continue;

        char *name = match_entity(source + ls, vend - ls);
        if (name) {
            sigs_add_entity(sigs, name);
            open = &sigs->e[sigs->len - 1];
            continue;
        }
        /* closing brace at the trimmed start */
        {
            size_t k = ls;
            while (k < vend && (source[k] == ' ' || source[k] == '\t')) k++;
            if (k < vend && source[k] == '}') { open = NULL; continue; }
        }
        if (open == NULL) continue;

        /* colon split */
        size_t colon = (size_t)-1;
        for (size_t j = ls; j < vend; j++) if (source[j] == ':') { colon = j; break; }
        if (colon == (size_t)-1) continue;

        bool optional = false;
        for (size_t j = ls; j < vend; j++) if (source[j] == '?') { optional = true; break; }

        char *fname = strip_optional(source, ls, colon);
        /* declared: trim, drop a trailing ';', strip '?' */
        size_t ds = colon + 1, de = vend;
        trim_bounds(source, &ds, &de);
        if (de > ds && source[de - 1] == ';') de--;
        char *declared = strip_optional(source, ds, de);

        if (fname[0] == '\0' || declared[0] == '\0') { free(fname); free(declared); continue; }
        /* re-find open (realloc may have moved the array) */
        open = &sigs->e[sigs->len - 1];
        entity_add_field(open, fname, declared, !optional);
    }
}

static char *read_contract(deon_ctx *ctx, const char *file, const deon_options *options) {
    char joined[4096];
    const char *target = file;
    bool is_abs = file[0] == '/';
    if (!is_abs && options->filebase && options->filebase[0]) {
        snprintf(joined, sizeof(joined), "%s/%s", options->filebase, file);
        target = joined;
    }

    for (size_t i = 0; i < options->resources_len; i++) {
        if (strcmp(options->resources[i].key, target) == 0) return dup_range(options->resources[i].value, strlen(options->resources[i].value));
    }
    for (size_t i = 0; i < options->resources_len; i++) {
        if (strcmp(options->resources[i].key, file) == 0) return dup_range(options->resources[i].value, strlen(options->resources[i].value));
    }

    if (!options->allow_filesystem) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Reading the datasign file '%s' requires filesystem access.", file);
        deon_fail(ctx, DEON_CAPABILITY_DENIED, msg, span_head(DATASIGN_SOURCE));
    }
    size_t len;
    deon_code err = DEON_OK;
    char *data = deon_read_file(target, &len, &err);
    if (!data) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Unable to read the datasign file '%s'.", file);
        deon_fail(ctx, DEON_RESOURCE_IO, msg, span_head(DATASIGN_SOURCE));
    }
    /* The bytes were read; their encoding is the fault, a resource-format error and not an I/O one. */
    if (!utf8_valid(data, len)) {
        free(data);
        char msg[512];
        snprintf(msg, sizeof(msg), "The datasign file '%s' is not valid UTF-8.", file);
        deon_fail(ctx, DEON_RESOURCE_FORMAT, msg, span_head(DATASIGN_SOURCE));
    }
    return data; /* malloc'd, NUL-terminated by deon_read_file */
}
/* #endregion */

/* #region applying a contract */
static const char *describe(const deon_value *v) {
    switch (v->kind) {
        case DEON_STRING: return "a string";
        case DEON_LIST:   return "a list";
        case DEON_MAP:    return "a map";
        default:          return "a value";
    }
}

static deon_value *type_datasign(deon_ctx *ctx, const deon_value *value, const char *declared, ds_sigs *sigs, const char *path);

static deon_value *type_leaf(deon_ctx *ctx, const deon_value *value, const char *declared, const char *path) {
    if (value->kind != DEON_STRING) {
        char msg[600];
        snprintf(msg, sizeof(msg), "Expected '%s' to be a string for '%s', found %s.", path, declared, describe(value));
        deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
    }
    deon_str text = value->as.string;
    if (strcmp(declared, "string") == 0) return (deon_value *)value;
    if (strcmp(declared, "boolean") == 0) {
        if (str_eq(text, "true")) return value_bool(ctx->a, true);
        if (str_eq(text, "false")) return value_bool(ctx->a, false);
        char msg[600], t[256];
        snprintf(t, sizeof(t), "%.*s", (int)text.len, text.data);
        snprintf(msg, sizeof(msg), "Expected '%s' to be 'true' or 'false' for 'boolean', found '%s'.", path, t);
        deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
    }
    /* number */
    char *tmp = dup_range(text.data, text.len);
    double n;
    bool ok = datasign_numeric(tmp, &n);
    free(tmp);
    if (!ok) {
        char msg[600], t[256];
        snprintf(t, sizeof(t), "%.*s", (int)text.len, text.data);
        snprintf(msg, sizeof(msg), "Expected '%s' to be a number, found '%s'.", path, t);
        deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
    }
    return value_number(ctx->a, n);
}

static deon_value *type_datasign(deon_ctx *ctx, const deon_value *value, const char *declared, ds_sigs *sigs, const char *path) {
    size_t dstart = 0, dend = strlen(declared);
    trim_bounds(declared, &dstart, &dend);
    char decl[256];
    snprintf(decl, sizeof(decl), "%.*s", (int)(dend - dstart), declared + dstart);

    size_t dl = strlen(decl);
    if (dl >= 2 && decl[dl - 2] == '[' && decl[dl - 1] == ']') {
        if (value->kind != DEON_LIST) {
            char msg[600];
            snprintf(msg, sizeof(msg), "Expected '%s' to be a list for '%s', found %s.", path, decl, describe(value));
            deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
        }
        char item[256];
        size_t is = 0, ie = dl - 2;
        trim_bounds(decl, &is, &ie);
        snprintf(item, sizeof(item), "%.*s", (int)(ie - is), decl + is);
        deon_value *out = value_empty_list(ctx->a);
        for (size_t i = 0; i < value->as.list.len; i++) {
            char idx[32];
            snprintf(idx, sizeof(idx), "%zu", i);
            char *sub = arena_path(ctx->a, "%s[%s]", path, idx);
            list_push(ctx->a, out, type_datasign(ctx, value->as.list.items[i], item, sigs, sub));
        }
        return out;
    }

    if (strcmp(decl, "string") == 0 || strcmp(decl, "number") == 0 || strcmp(decl, "boolean") == 0) {
        return type_leaf(ctx, value, decl, path);
    }

    ds_entity *entity = sigs_find(sigs, decl);
    if (!entity) return (deon_value *)value; /* a type defined elsewhere; not guessed at */

    if (value->kind != DEON_MAP) {
        char msg[600];
        snprintf(msg, sizeof(msg), "Expected '%s' to be a map for '%s', found %s.", path, decl, describe(value));
        deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
    }

    deon_value *out = value_empty_map(ctx->a);
    for (size_t i = 0; i < value->as.map.len; i++) {
        deon_str key = value->as.map.keys[i];
        deon_value *member = value->as.map.values[i];
        char *kc = dup_range(key.data, key.len);
        ds_field *field = NULL;
        for (size_t f = 0; f < entity->len; f++) if (strcmp(entity->fields[f].name, kc) == 0) { field = &entity->fields[f]; break; }
        if (field) {
            char *sub = arena_path(ctx->a, "%s.%s", path, kc);
            map_set(ctx->a, out, key, type_datasign(ctx, member, field->declared, sigs, sub));
        } else {
            map_set(ctx->a, out, key, member); /* verbatim */
        }
        free(kc);
    }
    for (size_t f = 0; f < entity->len; f++) {
        if (!entity->fields[f].required) continue;
        deon_str fname = arena_str_cstr(ctx->a, entity->fields[f].name);
        if (!map_get(value, fname, NULL)) {
            char *sub = arena_path(ctx->a, "%s.%s", path, entity->fields[f].name);
            char msg[600];
            snprintf(msg, sizeof(msg), "Required field '%s' of '%s' is missing.", sub, decl);
            deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
        }
    }
    return out;
}

static void sigs_free(ds_sigs *s) {
    for (size_t i = 0; i < s->len; i++) {
        free(s->e[i].name);
        for (size_t f = 0; f < s->e[i].len; f++) { free(s->e[i].fields[f].name); free(s->e[i].fields[f].declared); }
        free(s->e[i].fields);
    }
    free(s->e);
}

deon_value *sign_value(deon_ctx *ctx, deon_value *root, const deon_options *options) {
    if (options->datasign_map_len == 0) return root;

    ds_sigs sigs = {0};

    /* A nested boundary frees the malloc-backed contract table before re-raising, so a type mismatch
     * (or an unreadable contract mid-list) leaks nothing. */
    jmp_buf saved;
    memcpy(saved, ctx->jmp, sizeof(jmp_buf));
    if (setjmp(ctx->jmp)) {
        sigs_free(&sigs);
        memcpy(ctx->jmp, saved, sizeof(jmp_buf));
        longjmp(ctx->jmp, 1);
    }

    for (size_t i = 0; i < options->datasign_files_len; i++) {
        char *source = read_contract(ctx, options->datasign_files[i], options);
        parse_datasign(source, strlen(source), &sigs);
        free(source);
    }

    if (root->kind != DEON_MAP) {
        char msg[512];
        snprintf(msg, sizeof(msg), "A datasign map requires a root map, found %s.", describe(root));
        deon_fail(ctx, DEON_TYPE_MISMATCH, msg, span_head(DATASIGN_SOURCE));
    }

    deon_value *out = value_empty_map(ctx->a);
    for (size_t i = 0; i < root->as.map.len; i++) {
        deon_str key = root->as.map.keys[i];
        deon_value *member = root->as.map.values[i];
        const char *declared = NULL;
        for (size_t m = 0; m < options->datasign_map_len; m++) {
            if (str_eq(key, options->datasign_map[m].key)) { declared = options->datasign_map[m].value; break; }
        }
        if (declared) {
            char *kc = dup_range(key.data, key.len);
            map_set(ctx->a, out, key, type_datasign(ctx, member, declared, &sigs, kc));
            free(kc);
        } else {
            map_set(ctx->a, out, key, member);
        }
    }

    memcpy(ctx->jmp, saved, sizeof(jmp_buf));
    sigs_free(&sigs);
    return out;
}
/* #endregion */
