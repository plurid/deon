#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* Writing a value back to text (sections 12 and 13). Ordinary stringification preserves list and final
 * map write order; canonical form sorts every map by code point. A string is emitted in the shortest
 * form that reads back unchanged, and where a shorter form and a safer one both read back, the safer
 * one is the form, so two implementations agree on the canonical text character for character. */

/* #region character helpers (delimiters and name characters are ASCII, so byte scanning is safe) */
static bool c_space(char c) { return c == ' ' || c == '\t'; }
static bool c_delim(char c) {
    switch (c) {
        case '{': case '}': case '[': case ']':
        case '(': case ')': case '<': case '>':
        case '\'': case '`': return true;
        default: return false;
    }
}
static bool c_name(unsigned char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
           (c >= '0' && c <= '9') || c == '_' || c == '-';
}

/* A control character (section 4.3) is written with a `\u{…}` escape — its code point in lowercase
 * hexadecimal with no leading zeros — the one form that reads back unchanged and keeps the output plain
 * text: the escape character is `\u{1b}`, a null is `\u{0}`, a DEL is `\u{7f}`. */
static void write_u_escape(sb *b, uint32_t cp) {
    char hex[8];
    int n = snprintf(hex, sizeof hex, "%x", cp);
    sb_puts(b, "\\u{");
    sb_put(b, hex, (size_t)n);
    sb_putc(b, '}');
}
/* #endregion */

static bool needs_quote(deon_str s) {
    if (s.len == 0) return true;
    char first = s.data[0];
    char last = s.data[s.len - 1];
    if (c_space(first) || c_space(last) || first == '\n' || last == '\n') return true;
    const char *p = s.data, *end = s.data + s.len;
    while (p < end) {
        int w;
        uint32_t cp = utf8_decode(p, end, &w);
        /* A raw control character does not read back — it is a lexical error unquoted — so it forces the
         * quoted form, where it is written `\u{…}`. A C1 control is two source bytes, so the scan works in
         * code points. */
        if (is_control_rune(cp)) return true;
        if (cp < 0x80) {
            char c = (char)cp;
            /* A quote and an interior `#`, which section 4.3 makes harmless literal text, are quoted all
             * the same: two implementations may not disagree about the canonical form of a value (section
             * 13), so where a shorter safe form and a safer one both read back, the safer one is the form. */
            if (c_delim(c) || c == ',' || c == '\n' || c == '\r' || c == '\t' || c == '\\' || c == '#') return true;
            if (c == '/' && p + 1 < end && (p[1] == '/' || p[1] == '*')) return true;
        }
        p += w;
    }
    return false;
}

static bool use_backtick(deon_str s) {
    bool has_nl = false;
    const char *p = s.data, *end = s.data + s.len;
    while (p < end) {
        int w;
        uint32_t cp = utf8_decode(p, end, &w);
        if (cp == '\n') has_nl = true;
        if (cp == '\r') return false;
        /* A backtick string has no escape for a control character, so a value carrying one cannot take
         * the backtick form; it is single-quoted, where the `\u{…}` escape can spell it. */
        if (is_control_rune(cp)) return false;
        p += w;
    }
    if (!has_nl) return false;
    char first = s.data[0], last = s.data[s.len - 1];
    if (c_space(first) || first == '\n' || c_space(last) || last == '\n') return false;
    return true;
}

static void quote_string(sb *b, deon_str s) {
    sb_putc(b, '\'');
    const char *p = s.data, *end = s.data + s.len;
    while (p < end) {
        int w;
        uint32_t cp = utf8_decode(p, end, &w);
        if (cp == '\\') sb_puts(b, "\\\\");
        else if (cp == '\'') sb_puts(b, "\\'");
        else if (cp == '\n') sb_puts(b, "\\n");
        else if (cp == '\r') sb_puts(b, "\\r");
        else if (cp == '\t') sb_puts(b, "\\t");
        else if (cp == '#' && p + 1 < end && p[1] == '{') { sb_puts(b, "\\#{"); p += 2; continue; }
        else if (is_control_rune(cp)) write_u_escape(b, cp);
        else sb_put(b, p, (size_t)w);
        p += w;
    }
    sb_putc(b, '\'');
}

static void backtick_form(sb *b, deon_str s) {
    sb_putc(b, '`');
    for (size_t i = 0; i < s.len; i++) {
        char c = s.data[i];
        if (c == '\\') sb_puts(b, "\\\\");
        else if (c == '`') sb_puts(b, "\\`");
        else if (c == '#' && i + 1 < s.len && s.data[i + 1] == '{') { sb_puts(b, "\\#{"); i++; }
        else sb_putc(b, c);
    }
    sb_putc(b, '`');
}

static void write_scalar(sb *b, deon_str s) {
    if (!needs_quote(s)) { sb_put(b, s.data, s.len); return; }
    if (use_backtick(s)) { backtick_form(b, s); return; }
    quote_string(b, s);
}

static void write_key(sb *b, deon_str key) {
    if (key.len == 0) { sb_puts(b, "''"); return; }
    for (size_t i = 0; i < key.len; i++) {
        if (!c_name((unsigned char)key.data[i])) { quote_string(b, key); return; }
    }
    sb_put(b, key.data, key.len);
}

static void write_link_name(sb *b, deon_str name) {
    if (name.len == 0) { sb_puts(b, "''"); return; }
    for (size_t i = 0; i < name.len; i++) {
        if (!c_name((unsigned char)name.data[i])) { quote_string(b, name); return; }
    }
    sb_put(b, name.data, name.len);
}

/* #region leaflink transform tree */
typedef enum { X_VALUE, X_REF, X_MAP, X_LIST } xkind;
typedef struct xnode xnode;
struct xnode {
    xkind kind;
    const deon_value *value; /* X_VALUE */
    deon_str ref_name;       /* X_REF */
    struct { deon_str *keys; xnode **vals; size_t len; } map;
    struct { xnode **items; size_t len; } list;
};

typedef struct { deon_str name; const deon_value *value; } leaflink_decl;

typedef struct {
    leaflink_decl *decls;
    size_t         len;
    size_t         cap;
    int            level;
    arena         *a;
} extractor;

static deon_str escape_segment(arena *a, deon_str seg) {
    sb b = {0};
    for (size_t i = 0; i < seg.len; i++) {
        char c = seg.data[i];
        if (c == '~') sb_puts(&b, "~0");
        else if (c == '/') sb_puts(&b, "~1");
        else sb_putc(&b, c);
    }
    return sb_into_arena(&b, a);
}

static deon_str leaflink_name(arena *a, deon_str *path, size_t path_len) {
    sb b = {0};
    for (size_t i = 0; i < path_len; i++) {
        if (i > 0) sb_putc(&b, '/');
        deon_str esc = escape_segment(a, path[i]);
        sb_put(&b, esc.data, esc.len);
    }
    return sb_into_arena(&b, a);
}

static xnode *extract(extractor *x, const deon_value *v, int depth, deon_str *path, size_t path_len) {
    bool container = v->kind == DEON_MAP || v->kind == DEON_LIST;
    if (container && depth >= x->level) {
        deon_str name = leaflink_name(x->a, path, path_len);
        if (x->len == x->cap) {
            x->cap = x->cap ? x->cap * 2 : 8;
            leaflink_decl *b = arena_alloc(x->a, x->cap * sizeof(leaflink_decl));
            if (x->len) memcpy(b, x->decls, x->len * sizeof(leaflink_decl));
            x->decls = b;
        }
        x->decls[x->len].name = name;
        x->decls[x->len].value = v;
        x->len++;
        xnode *r = arena_alloc(x->a, sizeof(xnode));
        r->kind = X_REF;
        r->ref_name = name;
        return r;
    }
    if (v->kind == DEON_MAP) {
        xnode *n = arena_alloc(x->a, sizeof(xnode));
        n->kind = X_MAP;
        n->map.keys = arena_alloc(x->a, v->as.map.len * sizeof(deon_str) + 1);
        n->map.vals = arena_alloc(x->a, v->as.map.len * sizeof(xnode *) + 1);
        n->map.len = v->as.map.len;
        for (size_t i = 0; i < v->as.map.len; i++) {
            deon_str *sub = arena_alloc(x->a, (path_len + 1) * sizeof(deon_str));
            memcpy(sub, path, path_len * sizeof(deon_str));
            sub[path_len] = v->as.map.keys[i];
            n->map.keys[i] = v->as.map.keys[i];
            n->map.vals[i] = extract(x, v->as.map.values[i], depth + 1, sub, path_len + 1);
        }
        return n;
    }
    if (v->kind == DEON_LIST) {
        xnode *n = arena_alloc(x->a, sizeof(xnode));
        n->kind = X_LIST;
        n->list.items = arena_alloc(x->a, v->as.list.len * sizeof(xnode *) + 1);
        n->list.len = v->as.list.len;
        for (size_t i = 0; i < v->as.list.len; i++) {
            char idx[24];
            int il = snprintf(idx, sizeof(idx), "%zu", i);
            deon_str *sub = arena_alloc(x->a, (path_len + 1) * sizeof(deon_str));
            memcpy(sub, path, path_len * sizeof(deon_str));
            sub[path_len] = arena_str(x->a, idx, (size_t)il);
            n->list.items[i] = extract(x, v->as.list.items[i], depth + 1, sub, path_len + 1);
        }
        return n;
    }
    xnode *n = arena_alloc(x->a, sizeof(xnode));
    n->kind = X_VALUE;
    n->value = v;
    return n;
}
/* #endregion */

/* #region writers */
static void indent(sb *b, int level, int width) {
    for (int i = 0; i < level * width; i++) sb_putc(b, ' ');
}

static void write_value(sb *b, const deon_value *v, int level, const deon_stringify_options *o);

static int cmp_str(const void *pa, const void *pb) {
    const deon_str *a = pa, *b = pb;
    size_t n = a->len < b->len ? a->len : b->len;
    int c = memcmp(a->data, b->data, n);
    if (c != 0) return c;
    return a->len < b->len ? -1 : a->len > b->len ? 1 : 0;
}

static void write_entry(sb *b, deon_str key, const deon_value *value, int level, const deon_stringify_options *o) {
    write_key(b, key);
    sb_putc(b, ' ');
    write_value(b, value, level, o);
}

static void write_map(sb *b, const deon_value *m, int level, const deon_stringify_options *o) {
    if (m->as.map.len == 0) { sb_puts(b, "{}"); return; }

    size_t n = m->as.map.len;
    size_t *order = malloc(n * sizeof(size_t));
    for (size_t i = 0; i < n; i++) order[i] = i;
    if (o->canonical) {
        /* sort indices by key code point (byte order == code-point order for UTF-8) */
        for (size_t i = 1; i < n; i++) {
            size_t k = order[i];
            size_t j = i;
            while (j > 0 && cmp_str(&m->as.map.keys[order[j - 1]], &m->as.map.keys[k]) > 0) {
                order[j] = order[j - 1];
                j--;
            }
            order[j] = k;
        }
    }

    if (!o->readable) {
        sb_putc(b, '{');
        for (size_t i = 0; i < n; i++) {
            if (i > 0) sb_puts(b, ", ");
            write_entry(b, m->as.map.keys[order[i]], m->as.map.values[order[i]], level, o);
        }
        sb_putc(b, '}');
        free(order);
        return;
    }

    sb_puts(b, "{\n");
    for (size_t i = 0; i < n; i++) {
        indent(b, level + 1, o->indentation);
        write_entry(b, m->as.map.keys[order[i]], m->as.map.values[order[i]], level + 1, o);
        sb_putc(b, '\n');
    }
    indent(b, level, o->indentation);
    sb_putc(b, '}');
    free(order);
}

static void write_list(sb *b, const deon_value *l, int level, const deon_stringify_options *o) {
    if (l->as.list.len == 0) { sb_puts(b, "[]"); return; }
    if (!o->readable) {
        sb_putc(b, '[');
        for (size_t i = 0; i < l->as.list.len; i++) {
            if (i > 0) sb_puts(b, ", ");
            write_value(b, l->as.list.items[i], level, o);
        }
        sb_putc(b, ']');
        return;
    }
    sb_puts(b, "[\n");
    for (size_t i = 0; i < l->as.list.len; i++) {
        indent(b, level + 1, o->indentation);
        write_value(b, l->as.list.items[i], level + 1, o);
        sb_putc(b, '\n');
    }
    indent(b, level, o->indentation);
    sb_putc(b, ']');
}

static void write_value(sb *b, const deon_value *v, int level, const deon_stringify_options *o) {
    switch (v->kind) {
        case DEON_STRING: write_scalar(b, v->as.string); break;
        case DEON_LIST:   write_list(b, v, level, o); break;
        case DEON_MAP:    write_map(b, v, level, o); break;
        case DEON_BOOL:   sb_puts(b, v->as.boolean ? "true" : "false"); break;
        case DEON_NUMBER: {
            char num[32];
            double d = v->as.number;
            if (d == (double)(long long)d) snprintf(num, sizeof(num), "%lld", (long long)d);
            else snprintf(num, sizeof(num), "%g", d);
            sb_puts(b, num);
            break;
        }
    }
}

/* the leaflink transform's writers */
static void write_x(sb *b, xnode *n, int level, const deon_stringify_options *o);

static void write_x_entry(sb *b, deon_str key, xnode *val, int level, const deon_stringify_options *o) {
    if (val->kind == X_REF) {
        if (o->leaflink_shortening && str_eq_str(val->ref_name, key)) {
            sb_putc(b, '#');
            write_link_name(b, val->ref_name);
            return;
        }
        write_key(b, key);
        sb_puts(b, " #");
        write_link_name(b, val->ref_name);
        return;
    }
    write_key(b, key);
    sb_putc(b, ' ');
    write_x(b, val, level, o);
}

static void write_x(sb *b, xnode *n, int level, const deon_stringify_options *o) {
    switch (n->kind) {
        case X_VALUE: write_value(b, n->value, level, o); break;
        case X_REF: sb_putc(b, '#'); write_link_name(b, n->ref_name); break;
        case X_MAP:
            if (n->map.len == 0) { sb_puts(b, "{}"); break; }
            sb_puts(b, "{\n");
            for (size_t i = 0; i < n->map.len; i++) {
                indent(b, level + 1, o->indentation);
                write_x_entry(b, n->map.keys[i], n->map.vals[i], level + 1, o);
                sb_putc(b, '\n');
            }
            indent(b, level, o->indentation);
            sb_putc(b, '}');
            break;
        case X_LIST:
            if (n->list.len == 0) { sb_puts(b, "[]"); break; }
            sb_puts(b, "[\n");
            for (size_t i = 0; i < n->list.len; i++) {
                indent(b, level + 1, o->indentation);
                write_x(b, n->list.items[i], level + 1, o);
                sb_putc(b, '\n');
            }
            indent(b, level, o->indentation);
            sb_putc(b, ']');
            break;
    }
}
/* #endregion */

/* guard_depth enforces the nesting limit on a host-built value the parser never met (section 11.1),
 * iteratively, before any recursive writer runs. Returns false when the limit is exceeded. The public
 * writers and the typer call it (via api.c) before their recursive passes. */
bool guard_depth(const deon_value *root) {
    typedef struct { const deon_value *v; int depth; } frame;
    size_t cap = 64, len = 0;
    frame *stack = malloc(cap * sizeof(frame));
    stack[len++] = (frame){root, 0};
    bool ok = true;
    while (len > 0) {
        frame f = stack[--len];
        if (f.depth > DEON_MAX_DEPTH) { ok = false; break; }
        if (f.v->kind == DEON_LIST) {
            for (size_t i = 0; i < f.v->as.list.len; i++) {
                if (len == cap) { cap *= 2; stack = realloc(stack, cap * sizeof(frame)); }
                stack[len++] = (frame){f.v->as.list.items[i], f.depth + 1};
            }
        } else if (f.v->kind == DEON_MAP) {
            for (size_t i = 0; i < f.v->as.map.len; i++) {
                if (len == cap) { cap *= 2; stack = realloc(stack, cap * sizeof(frame)); }
                stack[len++] = (frame){f.v->as.map.values[i], f.depth + 1};
            }
        }
    }
    free(stack);
    return ok;
}

char *stringify_value(const deon_value *value, const deon_stringify_options *opts, size_t *out_len) {
    deon_stringify_options o = *opts;
    if (o.indentation == 0) o.indentation = 4;

    /* The depth guard runs in the public writers (api.c) before this is reached, so by here the value is
     * known to nest within the limit. */
    sb b = {0};

    if (o.leaflinks && !o.canonical) {
        arena *a = arena_new();
        extractor x = {0};
        x.a = a;
        x.level = o.leaflink_level < 1 ? 1 : o.leaflink_level;
        xnode *root = extract(&x, value, 0, NULL, 0);

        if (o.generated_header) sb_puts(&b, "// Generated by Deon.\n\n");
        if (o.generated_comments) sb_puts(&b, "// Root.\n\n");
        write_x(&b, root, 0, &o);
        sb_putc(&b, '\n');
        for (size_t i = 0; i < x.len; i++) {
            sb_putc(&b, '\n');
            if (o.generated_comments && i == 0) sb_puts(&b, "// Leaflinks.\n\n");
            write_key(&b, x.decls[i].name);
            sb_putc(&b, ' ');
            write_value(&b, x.decls[i].value, 0, &o);
            sb_putc(&b, '\n');
        }
        arena_free(a);
        return sb_finish(&b, out_len);
    }

    if (o.generated_header) sb_puts(&b, "// Generated by Deon.\n\n");
    if (o.generated_comments) sb_puts(&b, "// Root.\n\n");
    write_value(&b, value, 0, &o);
    sb_putc(&b, '\n');
    return sb_finish(&b, out_len);
}
