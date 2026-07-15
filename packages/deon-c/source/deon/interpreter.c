#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* Evaluating a parsed document into a Deon value (section 11). Declarations resolve lazily and are
 * memoized, which is equivalent to the topological resolution the specification describes and detects a
 * cycle at the reference that closes it. Everything is allocated in one arena; a diagnostic longjmps to
 * the nearest boundary, and an import re-anchors any diagnostic it raises to its own statement. */

/* #region string sets and maps over the arena */
typedef struct {
    deon_str *items;
    size_t    len;
    size_t    cap;
    arena    *a;
} strset;

static bool strset_has(strset *s, deon_str v) {
    for (size_t i = 0; i < s->len; i++) if (str_eq_str(s->items[i], v)) return true;
    return false;
}
static void strset_add(strset *s, deon_str v) {
    if (s->len == s->cap) {
        size_t cap = s->cap ? s->cap * 2 : 8;
        deon_str *b = arena_alloc(s->a, cap * sizeof(deon_str));
        if (s->len) memcpy(b, s->items, s->len * sizeof(deon_str));
        s->items = b;
        s->cap = cap;
    }
    s->items[s->len++] = v;
}
static void strset_remove(strset *s, deon_str v) {
    for (size_t i = 0; i < s->len; i++) {
        if (str_eq_str(s->items[i], v)) {
            for (size_t j = i; j + 1 < s->len; j++) s->items[j] = s->items[j + 1];
            s->len--;
            return;
        }
    }
}

typedef struct {
    deon_str    name;
    deon_value *value;
} name_value;

typedef struct {
    name_value *items;
    size_t      len;
    size_t      cap;
    arena      *a;
} value_cache;

static bool cache_get(value_cache *c, deon_str name, deon_value **out) {
    for (size_t i = 0; i < c->len; i++) if (str_eq_str(c->items[i].name, name)) { *out = c->items[i].value; return true; }
    return false;
}
static void cache_put(value_cache *c, deon_str name, deon_value *value) {
    if (c->len == c->cap) {
        size_t cap = c->cap ? c->cap * 2 : 8;
        name_value *b = arena_alloc(c->a, cap * sizeof(name_value));
        if (c->len) memcpy(b, c->items, c->len * sizeof(name_value));
        c->items = b;
        c->cap = cap;
    }
    c->items[c->len].name = name;
    c->items[c->len].value = value;
    c->len++;
}
/* #endregion */

typedef struct {
    deon_str name;
    deon_str value;
} local_binding;

typedef struct {
    local_binding *bindings;
    size_t         len;
} local_frame;

struct interpreter {
    deon_ctx           *ctx;
    const deon_options *options;

    struct { deon_str name; declaration *decl; } *decls;
    size_t decls_len;

    value_cache cache;
    strset      resolving;
    strset      calling;

    local_frame *locals;
    size_t       locals_len;
    size_t       locals_cap;

    strset *opened; /* shared with sub-interpreters, for import cycle detection */

    const char *source_name;
    const char *filebase;
};

static deon_value *eval(interpreter *in, node *n);
static deon_value *resolve_reference(interpreter *in, reference ref);
static deon_value *eval_import(interpreter *in, declaration *d);
static deon_value *eval_inject(interpreter *in, declaration *d);

/* #region options lookup helpers */
static const char *pair_lookup(const deon_pair *pairs, size_t len, const char *key) {
    for (size_t i = 0; i < len; i++) if (strcmp(pairs[i].key, key) == 0) return pairs[i].value;
    return NULL;
}
static const char *pair_lookup_str(const deon_pair *pairs, size_t len, deon_str key) {
    for (size_t i = 0; i < len; i++) {
        if (strlen(pairs[i].key) == key.len && memcmp(pairs[i].key, key.data, key.len) == 0) return pairs[i].value;
    }
    return NULL;
}
/* #endregion */

/* #region evaluation */
static deon_value *eval_scalar(interpreter *in, node *n) {
    /* A single literal part is the common case; return it without building. */
    sb b = {0};
    for (size_t i = 0; i < n->as.scalar.len; i++) {
        string_part part = n->as.scalar.parts[i];
        if (!part.is_interp) {
            sb_put(&b, part.literal.data, part.literal.len);
            continue;
        }
        /* An interpolation is reported at the string that carries it, not inside it: the reference was
         * recovered by decoding and has no source position of its own. */
        reference ref = part.interp;
        ref.span = n->span;
        deon_value *value = resolve_reference(in, ref);
        if (value->kind != DEON_STRING) {
            sb_free(&b);
            deon_fail(in->ctx, DEON_TYPE_MISMATCH, "An interpolation must resolve to a string.", n->span);
        }
        sb_put(&b, value->as.string.data, value->as.string.len);
    }
    return value_string(in->ctx->a, sb_into_arena(&b, in->ctx->a));
}

static void spread_into_map(interpreter *in, deon_value *dest, reference ref) {
    deon_value *value = resolve_reference(in, ref);
    if (value->kind == DEON_MAP) {
        for (size_t i = 0; i < value->as.map.len; i++) {
            map_set(in->ctx->a, dest, value->as.map.keys[i], value->as.map.values[i]);
        }
    } else if (value->kind == DEON_STRING) {
        /* A string spreads into a map using decimal character indices (section 7). */
        const char *s = value->as.string.data;
        const char *end = s + value->as.string.len;
        int index = 0;
        while (s < end) {
            int w;
            uint32_t r = utf8_decode(s, end, &w);
            sb rb = {0};
            utf8_encode(r, &rb);
            char keybuf[24];
            int kl = snprintf(keybuf, sizeof(keybuf), "%d", index);
            map_set(in->ctx->a, dest, arena_str(in->ctx->a, keybuf, kl),
                    value_string(in->ctx->a, sb_into_arena(&rb, in->ctx->a)));
            s += w;
            index++;
        }
    } else {
        deon_fail(in->ctx, DEON_TYPE_MISMATCH, "A list cannot spread into a map.", ref.span);
    }
}

static void spread_into_list(interpreter *in, deon_value *dest, reference ref) {
    deon_value *value = resolve_reference(in, ref);
    if (value->kind == DEON_LIST) {
        for (size_t i = 0; i < value->as.list.len; i++) list_push(in->ctx->a, dest, value->as.list.items[i]);
    } else if (value->kind == DEON_STRING) {
        const char *s = value->as.string.data;
        const char *end = s + value->as.string.len;
        while (s < end) {
            int w;
            uint32_t r = utf8_decode(s, end, &w);
            sb rb = {0};
            utf8_encode(r, &rb);
            list_push(in->ctx->a, dest, value_string(in->ctx->a, sb_into_arena(&rb, in->ctx->a)));
            s += w;
        }
    } else {
        deon_fail(in->ctx, DEON_TYPE_MISMATCH, "A map cannot spread into a list.", ref.span);
    }
}

static deon_value *eval_map(interpreter *in, node *n) {
    deon_value *result = value_empty_map(in->ctx->a);
    for (size_t i = 0; i < n->as.map.len; i++) {
        map_entry e = n->as.map.entries[i];
        if (e.spread) { spread_into_map(in, result, *e.spread); continue; }
        map_set(in->ctx->a, result, e.key, eval(in, e.value));
    }
    return result;
}

static deon_value *eval_list(interpreter *in, node *n) {
    deon_value *result = value_empty_list(in->ctx->a);
    for (size_t i = 0; i < n->as.list.len; i++) {
        list_item it = n->as.list.items[i];
        if (it.spread) { spread_into_list(in, result, *it.spread); continue; }
        list_push(in->ctx->a, result, eval(in, it.value));
    }
    return result;
}

static deon_value *eval_structure(interpreter *in, node *n) {
    deon_value *result = value_empty_list(in->ctx->a);
    size_t cols = n->as.structure.fields_len;
    for (size_t r = 0; r < n->as.structure.rows_len; r++) {
        deon_value *entry = value_empty_map(in->ctx->a);
        for (size_t c = 0; c < cols; c++) {
            map_set(in->ctx->a, entry, n->as.structure.fields[c], eval(in, n->as.structure.cells[r * cols + c]));
        }
        list_push(in->ctx->a, result, entry);
    }
    return result;
}

/* interpolation names of an entity body: its exact parameter set (section 10). A link composes and
 * stays private; an interpolation is a hole and is always a parameter. */
static void collect_interp_names(node *n, strset *set) {
    switch (n->kind) {
        case NODE_SCALAR:
            for (size_t i = 0; i < n->as.scalar.len; i++) {
                string_part part = n->as.scalar.parts[i];
                if (part.is_interp && !part.interp.env && !strset_has(set, part.interp.head)) {
                    strset_add(set, part.interp.head);
                }
            }
            break;
        case NODE_MAP:
            for (size_t i = 0; i < n->as.map.len; i++) if (n->as.map.entries[i].value) collect_interp_names(n->as.map.entries[i].value, set);
            break;
        case NODE_LIST:
            for (size_t i = 0; i < n->as.list.len; i++) if (n->as.list.items[i].value) collect_interp_names(n->as.list.items[i].value, set);
            break;
        case NODE_STRUCTURE: {
            size_t total = n->as.structure.rows_len * n->as.structure.fields_len;
            for (size_t i = 0; i < total; i++) collect_interp_names(n->as.structure.cells[i], set);
            break;
        }
        default: break;
    }
}

void interpolation_names(node *n, arena *a, deon_str **out, size_t *out_len) {
    strset set = {0};
    set.a = a;
    collect_interp_names(n, &set);
    *out = set.items;
    *out_len = set.len;
}

static deon_value *eval_call(interpreter *in, node *n) {
    deon_str name = n->as.call.ref.head;
    if (n->as.call.ref.access_len > 0) {
        deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "A call names a leaflink directly.", n->span);
    }

    declaration *decl = NULL;
    for (size_t i = 0; i < in->decls_len; i++) if (str_eq_str(in->decls[i].name, name)) { decl = in->decls[i].decl; break; }
    if (!decl || decl->kind != DECL_LEAFLINK) {
        deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "There is no entity to call.", n->span);
    }

    strset params = {0};
    params.a = in->ctx->a;
    collect_interp_names(decl->value, &params);

    /* the local bindings for this call */
    local_binding *bindings = arena_alloc(in->ctx->a, (n->as.call.args_len + 1) * sizeof(local_binding));
    size_t nb = 0;
    for (size_t i = 0; i < n->as.call.args_len; i++) {
        call_arg a = n->as.call.args[i];
        for (size_t j = 0; j < nb; j++) if (str_eq_str(bindings[j].name, a.name)) {
            deon_fail(in->ctx, DEON_ENTITY_ARGUMENT, "An argument is given more than once.", a.name_span);
        }
        if (!strset_has(&params, a.name)) {
            deon_fail(in->ctx, DEON_ENTITY_ARGUMENT, "There is no such parameter.", n->as.call.args_span);
        }
        deon_value *v = eval(in, a.value);
        if (v->kind != DEON_STRING) {
            deon_fail(in->ctx, DEON_ENTITY_ARGUMENT, "An argument must be a string.", a.name_span);
        }
        bindings[nb].name = a.name;
        bindings[nb].value = v->as.string;
        nb++;
    }
    for (size_t i = 0; i < params.len; i++) {
        bool given = false;
        for (size_t j = 0; j < nb; j++) if (str_eq_str(bindings[j].name, params.items[i])) { given = true; break; }
        if (!given) deon_fail(in->ctx, DEON_ENTITY_ARGUMENT, "A required argument is missing.", n->as.call.args_span);
    }

    if (strset_has(&in->calling, name)) {
        deon_fail(in->ctx, DEON_CYCLE, "The entity calls itself.", n->span);
    }
    strset_add(&in->calling, name);

    if (in->locals_len == in->locals_cap) {
        size_t cap = in->locals_cap ? in->locals_cap * 2 : 8;
        local_frame *b = arena_alloc(in->ctx->a, cap * sizeof(local_frame));
        if (in->locals_len) memcpy(b, in->locals, in->locals_len * sizeof(local_frame));
        in->locals = b;
        in->locals_cap = cap;
    }
    in->locals[in->locals_len].bindings = bindings;
    in->locals[in->locals_len].len = nb;
    in->locals_len++;

    deon_value *value = eval(in, decl->value);

    in->locals_len--;
    strset_remove(&in->calling, name);
    return value;
}

static deon_value *eval(interpreter *in, node *n) {
    switch (n->kind) {
        case NODE_SCALAR: return eval_scalar(in, n);
        case NODE_MAP:    return eval_map(in, n);
        case NODE_LIST:   return eval_list(in, n);
        case NODE_STRUCTURE: return eval_structure(in, n);
        case NODE_LINK: {
            reference ref = n->as.link.ref;
            ref.span = n->span; /* a link's diagnostic is at its #, not the name after it */
            return resolve_reference(in, ref);
        }
        case NODE_CALL: return eval_call(in, n);
    }
    return value_string_cstr(in->ctx->a, "");
}
/* #endregion */

/* #region references */
static deon_value *apply_access(interpreter *in, deon_value *value, access_seg *access, size_t len, deon_span span) {
    for (size_t i = 0; i < len; i++) {
        access_seg seg = access[i];
        if (value->kind == DEON_MAP) {
            deon_value *member;
            if (!map_get(value, seg.name, &member)) {
                deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "There is no such member.", span);
            }
            value = member;
        } else if (value->kind == DEON_LIST) {
            if (!seg.by_index) deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "A list is indexed by a number.", span);
            if (seg.index < 0 || (unsigned long long)seg.index >= value->as.list.len) {
                deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "The list index is out of range.", span);
            }
            value = value->as.list.items[(size_t)seg.index];
        } else {
            deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "A string has no members to access.", span);
        }
    }
    return value;
}

static deon_value *eval_declaration(interpreter *in, declaration *decl) {
    switch (decl->kind) {
        case DECL_LEAFLINK: return eval(in, decl->value);
        case DECL_IMPORT:   return eval_import(in, decl);
        case DECL_INJECT:   return eval_inject(in, decl);
    }
    return value_string_cstr(in->ctx->a, "");
}

static deon_value *resolve_head(interpreter *in, deon_str name, deon_span span) {
    for (long i = (long)in->locals_len - 1; i >= 0; i--) {
        for (size_t j = 0; j < in->locals[i].len; j++) {
            if (str_eq_str(in->locals[i].bindings[j].name, name)) {
                return value_string(in->ctx->a, in->locals[i].bindings[j].value);
            }
        }
    }

    declaration *decl = NULL;
    for (size_t i = 0; i < in->decls_len; i++) if (str_eq_str(in->decls[i].name, name)) { decl = in->decls[i].decl; break; }
    if (!decl) deon_fail(in->ctx, DEON_UNRESOLVED_LINK, "There is no such declaration.", span);

    deon_value *cached;
    if (cache_get(&in->cache, name, &cached)) return cached;
    if (strset_has(&in->resolving, name)) {
        deon_fail(in->ctx, DEON_CYCLE, "The declaration depends on itself.", span);
    }

    strset_add(&in->resolving, name);
    deon_value *value = eval_declaration(in, decl);
    strset_remove(&in->resolving, name);
    cache_put(&in->cache, name, value);
    return value;
}

static deon_value *resolve_reference(interpreter *in, reference ref) {
    if (ref.env) {
        const char *v = pair_lookup_str(in->options->environment, in->options->environment_len, ref.head);
        return value_string_cstr(in->ctx->a, v ? v : "");
    }
    deon_value *value = resolve_head(in, ref.head, ref.span);
    return apply_access(in, value, ref.access, ref.access_len, ref.span);
}
/* #endregion */

/* #region path and URL helpers */
static bool is_url(const char *t) {
    return strncmp(t, "http://", 7) == 0 || strncmp(t, "https://", 8) == 0;
}

/* extension_of: the trailing ".ext" of the last path segment, or "" if none. */
static const char *extension_of(const char *t) {
    const char *path = t;
    if (is_url(t)) {
        const char *slashes = strstr(t, "://");
        const char *p = strchr(slashes + 3, '/');
        path = p ? p : "";
    }
    const char *last_slash = strrchr(path, '/');
    const char *seg = last_slash ? last_slash + 1 : path;
    /* strip query/fragment for urls */
    const char *dot = strrchr(seg, '.');
    if (!dot || dot == seg) return "";
    return dot; /* includes the dot */
}

/* normalize_path collapses "." and ".." segments in an absolute or relative path. */
static char *normalize_path(arena *a, const char *path) {
    size_t n = strlen(path);
    char *out = arena_alloc(a, n + 2);
    /* segment stack (offsets into a scratch) */
    const char *segs[256];
    size_t seglen[256];
    size_t nseg = 0;
    bool absolute = n > 0 && path[0] == '/';
    size_t i = 0;
    while (i < n) {
        while (i < n && path[i] == '/') i++;
        size_t start = i;
        while (i < n && path[i] != '/') i++;
        size_t len = i - start;
        if (len == 0) continue;
        if (len == 1 && path[start] == '.') continue;
        if (len == 2 && path[start] == '.' && path[start + 1] == '.') {
            if (nseg > 0) nseg--;
            continue;
        }
        if (nseg < 256) { segs[nseg] = path + start; seglen[nseg] = len; nseg++; }
    }
    size_t o = 0;
    if (absolute) out[o++] = '/';
    for (size_t s = 0; s < nseg; s++) {
        if (s > 0) out[o++] = '/';
        memcpy(out + o, segs[s], seglen[s]);
        o += seglen[s];
    }
    out[o] = '\0';
    if (o == 0) { out[0] = '.'; out[1] = '\0'; }
    return out;
}

/* directory_of: the directory portion. For a URL, the scheme+host is preserved and a trailing slash
 * added; for a path, path.Dir semantics. */
static char *directory_of(arena *a, const char *t) {
    if (is_url(t)) {
        const char *slashes = strstr(t, "://");
        const char *p = strchr(slashes + 3, '/');
        if (!p) return arena_memdup(a, t, strlen(t));
        const char *last = strrchr(p, '/');
        size_t plen = (size_t)(last - t) + 1; /* include trailing slash */
        return arena_memdup(a, t, plen);
    }
    const char *last = strrchr(t, '/');
    if (!last) return arena_memdup(a, ".", 1);
    if (last == t) return arena_memdup(a, "/", 1);
    return arena_memdup(a, t, (size_t)(last - t));
}

static char *path_join(arena *a, const char *base, const char *rel) {
    if (base[0] == '\0') return normalize_path(a, rel);
    size_t bl = strlen(base), rl = strlen(rel);
    char *buf = arena_alloc(a, bl + rl + 2);
    memcpy(buf, base, bl);
    buf[bl] = '/';
    memcpy(buf + bl + 1, rel, rl);
    buf[bl + 1 + rl] = '\0';
    return normalize_path(a, buf);
}

/* url_join resolves rel against a base URL that ends at a directory. */
static char *url_join(arena *a, const char *base, const char *rel) {
    if (is_url(rel)) return arena_memdup(a, rel, strlen(rel));
    const char *slashes = strstr(base, "://");
    const char *host_start = slashes + 3;
    const char *path = strchr(host_start, '/');
    size_t prefix_len = path ? (size_t)(path - base) : strlen(base);
    const char *basepath = path ? path : "/";

    char *combined;
    if (rel[0] == '/') {
        combined = normalize_path(a, rel);
    } else {
        /* base dir up to last slash */
        char *bp = arena_memdup(a, basepath, strlen(basepath));
        char *last = strrchr(bp, '/');
        if (last) last[1] = '\0';
        size_t dl = strlen(bp), rl = strlen(rel);
        char *joined = arena_alloc(a, dl + rl + 1);
        memcpy(joined, bp, dl);
        memcpy(joined + dl, rel, rl);
        joined[dl + rl] = '\0';
        combined = normalize_path(a, joined);
    }
    char *out = arena_alloc(a, prefix_len + strlen(combined) + 1);
    memcpy(out, base, prefix_len);
    strcpy(out + prefix_len, combined);
    return out;
}

/* map_absolute applies the absolutePaths option: exact keys win before wildcards; among the
 * slash-star wildcards the longest prefix wins, and the unmatched suffix is appended to the mapping. */
static const char *map_absolute(interpreter *in, const char *target) {
    const deon_options *o = in->options;
    if (o->absolute_paths_len == 0) return target;
    const char *exact = pair_lookup(o->absolute_paths, o->absolute_paths_len, target);
    if (exact) return exact;

    const char *best_key = NULL;
    size_t best_len = 0;
    for (size_t i = 0; i < o->absolute_paths_len; i++) {
        const char *key = o->absolute_paths[i].key;
        size_t kl = strlen(key);
        if (kl < 2 || key[kl - 1] != '*' || key[kl - 2] != '/') continue;
        size_t prefix_len = kl - 1; /* keep trailing slash */
        if (strncmp(target, key, prefix_len) == 0 && prefix_len > best_len) {
            best_key = key;
            best_len = prefix_len;
        }
    }
    if (!best_key) return target;
    const char *mapped = pair_lookup(o->absolute_paths, o->absolute_paths_len, best_key);
    const char *remainder = target + best_len;
    size_t ml = strlen(mapped);
    while (ml > 0 && mapped[ml - 1] == '/') ml--;
    char *out = arena_alloc(in->ctx->a, ml + 1 + strlen(remainder) + 1);
    memcpy(out, mapped, ml);
    out[ml] = '/';
    strcpy(out + ml + 1, remainder);
    return out;
}

static const char *resolve_target(interpreter *in, const char *target) {
    const char *resolved = target;
    if (is_url(target)) {
        /* already absolute */
    } else if (target[0] == '/') {
        /* logical absolute, left for the absolutePaths mapping */
    } else if (in->filebase && in->filebase[0] && is_url(in->filebase)) {
        char base[2048];
        snprintf(base, sizeof(base), "%s", in->filebase);
        size_t bl = strlen(base);
        if (bl && base[bl - 1] != '/') { base[bl] = '/'; base[bl + 1] = '\0'; }
        resolved = url_join(in->ctx->a, base, target);
    } else {
        resolved = path_join(in->ctx->a, in->filebase ? in->filebase : "", target);
    }
    return map_absolute(in, resolved);
}

static const char *import_target(interpreter *in, const char *target) {
    if (extension_of(target)[0] == '\0') {
        size_t tl = strlen(target);
        char *out = arena_alloc(in->ctx->a, tl + 6);
        memcpy(out, target, tl);
        strcpy(out + tl, ".deon");
        return out;
    }
    return target;
}
/* #endregion */

/* #region loading */
typedef struct {
    deon_str    data;
    const char *filetype;
    const char *filebase;
    const char *resource_id;
} fetched;

static const char *token_for(interpreter *in, const char *target) {
    /* the bearer for a host, from authorization keyed by exact lowercase hostname */
    if (!is_url(target)) return "";
    const char *slashes = strstr(target, "://");
    const char *host_start = slashes + 3;
    const char *host_end = host_start;
    while (*host_end && *host_end != '/' && *host_end != ':') host_end++;
    char host[256];
    size_t hl = (size_t)(host_end - host_start);
    if (hl >= sizeof(host)) hl = sizeof(host) - 1;
    for (size_t i = 0; i < hl; i++) {
        char c = host_start[i];
        host[i] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
    }
    host[hl] = '\0';
    const char *tok = pair_lookup(in->options->authorization, in->options->authorization_len, host);
    return tok ? tok : "";
}

static fetched load_resource(interpreter *in, const char *target, const char *kind, const char *token, deon_span span) {
    fetched f;
    memset(&f, 0, sizeof(f));
    f.filetype = strcmp(kind, "import") == 0 ? extension_of(target) : "";
    f.resource_id = target;
    f.filebase = directory_of(in->ctx->a, target);

    /* in-memory resources first */
    const char *mem = pair_lookup(in->options->resources, in->options->resources_len, target);
    if (mem) {
        f.data = arena_str_cstr(in->ctx->a, mem);
        return f;
    }

    if (is_url(target)) {
        if (!in->options->allow_network) {
            deon_fail(in->ctx, DEON_CAPABILITY_DENIED, "The resource was not permitted: network access is not allowed.", span);
        }
        const char *credential = token && token[0] ? token : token_for(in, target);
        deon_str cached;
        if (cache_read(in->options, target, credential, in->ctx->a, &cached)) {
            f.data = cached;
            return f;
        }
        deon_str body = http_get(in->ctx, target, kind, credential, span);
        cache_write(in->options, target, credential, body);
        f.data = body;
        return f;
    }

    if (!in->options->allow_filesystem) {
        deon_fail(in->ctx, DEON_CAPABILITY_DENIED, "The resource was not permitted: filesystem access is not allowed.", span);
    }
    size_t len;
    deon_code err;
    char *bytes = deon_read_file(target, &len, &err);
    if (!bytes) {
        deon_fail(in->ctx, DEON_RESOURCE_IO, "Unable to read the resource.", span);
    }
    if (!utf8_valid(bytes, len)) {
        free(bytes);
        deon_fail(in->ctx, DEON_RESOURCE_FORMAT, "The resource is not valid UTF-8.", span);
    }
    f.data = arena_str(in->ctx->a, bytes, len);
    free(bytes);
    return f;
}

static deon_str resolve_authenticator(interpreter *in, declaration *d) {
    if (!d->authenticator) { deon_str e = {0}; e.data = ""; return e; }
    deon_value *v = eval(in, d->authenticator);
    if (v->kind != DEON_STRING) {
        deon_fail(in->ctx, DEON_TYPE_MISMATCH, "An authenticator must resolve to a string.", d->span);
    }
    return v->as.string;
}

static interpreter *interpreter_fresh(deon_ctx *ctx, const deon_options *options);

/* run a sub-evaluation with a nested boundary that re-anchors any diagnostic to `at` (unless it is a
 * cycle, which keeps its own span). Returns the value, or re-raises to the outer boundary. */
static deon_value *reanchored(deon_ctx *ctx, deon_value *(*body)(void *), void *arg, deon_span at) {
    jmp_buf outer;
    memcpy(outer, ctx->jmp, sizeof(jmp_buf));
    if (setjmp(ctx->jmp) == 0) {
        deon_value *v = body(arg);
        memcpy(ctx->jmp, outer, sizeof(jmp_buf));
        return v;
    }
    memcpy(ctx->jmp, outer, sizeof(jmp_buf));
    if (ctx->code != DEON_CYCLE) ctx->span = at;
    longjmp(ctx->jmp, 1);
}

typedef struct {
    interpreter *in;
    fetched      f;
} import_deon_arg;

static deon_value *import_deon_body(void *arg) {
    import_deon_arg *a = arg;
    interpreter *in = a->in;
    document_ast *doc = parse_document(in->ctx, a->f.data.data, a->f.data.len, a->f.resource_id);

    interpreter *sub = interpreter_fresh(in->ctx, in->options);
    sub->source_name = a->f.resource_id;
    sub->filebase = a->f.filebase;
    sub->opened = in->opened; /* shared */

    /* register declarations */
    for (size_t i = 0; i < doc->decls_len; i++) {
        declaration *d = &doc->decls[i];
        for (size_t j = 0; j < sub->decls_len; j++) if (str_eq_str(sub->decls[j].name, d->name)) {
            deon_fail(in->ctx, DEON_DUPLICATE_DECLARATION, "The name is declared more than once.", d->name_span);
        }
        sub->decls[sub->decls_len].name = d->name;
        sub->decls[sub->decls_len].decl = d;
        sub->decls_len++;
    }
    return eval(sub, doc->root);
}

typedef struct {
    deon_ctx  *ctx;
    deon_str   data;
    deon_span  at;
} json_arg;

static deon_value *json_body(void *arg) {
    json_arg *a = arg;
    return json_to_value(a->ctx, a->data.data, a->data.len, a->at);
}

static deon_value *eval_import(interpreter *in, declaration *d) {
    deon_str token = resolve_authenticator(in, d);
    const char *target = import_target(in, resolve_target(in, arena_memdup(in->ctx->a, d->target.data, d->target.len)));

    fetched f = load_resource(in, target, "import", token.data, d->span);

    if (strset_has(in->opened, arena_str_cstr(in->ctx->a, f.resource_id))) {
        deon_fail(in->ctx, DEON_CYCLE, "The resource imports itself.", d->span);
    }
    deon_str rid = arena_str_cstr(in->ctx->a, f.resource_id);
    strset_add(in->opened, rid);

    deon_value *result;
    const char *ext = f.filetype;
    if (strcmp(ext, ".json") == 0) {
        json_arg ja = { in->ctx, f.data, d->span };
        result = reanchored(in->ctx, json_body, &ja, d->span);
    } else if (ext[0] != '\0' && strcmp(ext, ".deon") != 0) {
        deon_fail(in->ctx, DEON_RESOURCE_FORMAT, "The import has an unsupported extension.", d->span);
        result = NULL;
    } else {
        import_deon_arg ia = { in, f };
        result = reanchored(in->ctx, import_deon_body, &ia, d->span);
    }

    strset_remove(in->opened, rid);
    return result;
}

static deon_value *eval_inject(interpreter *in, declaration *d) {
    deon_str token = resolve_authenticator(in, d);
    const char *target = resolve_target(in, arena_memdup(in->ctx->a, d->target.data, d->target.len));
    fetched f = load_resource(in, target, "inject", token.data, d->span);
    return value_string(in->ctx->a, f.data);
}
/* #endregion */

/* #region entry */
static interpreter *interpreter_fresh(deon_ctx *ctx, const deon_options *options) {
    interpreter *in = arena_alloc(ctx->a, sizeof(*in));
    memset(in, 0, sizeof(*in));
    in->ctx = ctx;
    in->options = options;
    in->cache.a = ctx->a;
    in->resolving.a = ctx->a;
    in->calling.a = ctx->a;
    in->decls = arena_alloc(ctx->a, 16 * sizeof(*in->decls));
    /* decls capacity grows as needed */
    in->decls_len = 0;
    return in;
}

deon_value *evaluate(deon_ctx *ctx, document_ast *doc, const deon_options *options) {
    interpreter *in = interpreter_fresh(ctx, options);
    in->source_name = options->source_name && options->source_name[0] ? options->source_name : "<memory>";
    in->filebase = options->filebase ? options->filebase : "";

    strset *opened = arena_alloc(ctx->a, sizeof(strset));
    memset(opened, 0, sizeof(*opened));
    opened->a = ctx->a;
    in->opened = opened;
    if (in->source_name[0]) strset_add(in->opened, arena_str_cstr(ctx->a, in->source_name));

    /* declarations grow */
    size_t cap = 16;
    for (size_t i = 0; i < doc->decls_len; i++) {
        declaration *d = &doc->decls[i];
        for (size_t j = 0; j < in->decls_len; j++) if (str_eq_str(in->decls[j].name, d->name)) {
            deon_fail(ctx, DEON_DUPLICATE_DECLARATION, "The name is declared more than once.", d->name_span);
        }
        if (in->decls_len == cap) {
            cap *= 2;
            void *b = arena_alloc(ctx->a, cap * sizeof(*in->decls));
            memcpy(b, in->decls, in->decls_len * sizeof(*in->decls));
            in->decls = b;
        }
        in->decls[in->decls_len].name = d->name;
        in->decls[in->decls_len].decl = d;
        in->decls_len++;
    }

    return eval(in, doc->root);
}
/* #endregion */
