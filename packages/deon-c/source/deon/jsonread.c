#include "internal.h"

#include <string.h>

/* JSON to a Deon value (section 9.1). The one rule that is easy to get wrong: a number keeps its
 * source token spelling, so 1.50 becomes the string "1.50" and not "1.5" — reading it with a host's
 * float would give the same file two different meanings depending on how it arrived. A Boolean becomes
 * the string "true" or "false", and null becomes the empty string, because Deon has neither. */

typedef struct {
    const char *s;
    const char *end;
    deon_ctx   *ctx;
    deon_span   at;
    int         depth;
} jparser;

static void jfail(jparser *p) {
    deon_fail(p->ctx, DEON_RESOURCE_FORMAT, "The resource is not valid JSON.", p->at);
}

/* Nesting past the value-nesting limit is not a JSON-syntax fault but the same depth refusal the parser
 * raises on an over-deep Deon document (section 11.1): DEON_PARSE_EXPECTED, not DEON_RESOURCE_FORMAT.
 * Reporting it here — inside the import's re-anchoring boundary — anchors it to the importing statement
 * rather than leaving a too-deep value to be caught later at a writer with no position to point at. */
static void jdepth(jparser *p) {
    deon_fail(p->ctx, DEON_PARSE_EXPECTED, "The resource nests more deeply than Deon will read.", p->at);
}

static void jws(jparser *p) {
    while (p->s < p->end) {
        char c = *p->s;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') p->s++;
        else break;
    }
}

static deon_value *jvalue(jparser *p);

static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static deon_str jstring_raw(jparser *p) {
    if (p->s >= p->end || *p->s != '"') jfail(p);
    p->s++;
    sb b = {0};
    while (p->s < p->end) {
        char c = *p->s++;
        if (c == '"') return sb_into_arena(&b, p->ctx->a);
        if (c == '\\') {
            if (p->s >= p->end) { sb_free(&b); jfail(p); }
            char e = *p->s++;
            switch (e) {
                case '"': sb_putc(&b, '"'); break;
                case '\\': sb_putc(&b, '\\'); break;
                case '/': sb_putc(&b, '/'); break;
                case 'b': sb_putc(&b, '\b'); break;
                case 'f': sb_putc(&b, '\f'); break;
                case 'n': sb_putc(&b, '\n'); break;
                case 'r': sb_putc(&b, '\r'); break;
                case 't': sb_putc(&b, '\t'); break;
                case 'u': {
                    if (p->end - p->s < 4) { sb_free(&b); jfail(p); }
                    int h = 0;
                    for (int i = 0; i < 4; i++) {
                        int v = hexval(p->s[i]);
                        if (v < 0) { sb_free(&b); jfail(p); }
                        h = (h << 4) | v;
                    }
                    p->s += 4;
                    uint32_t rune = (uint32_t)h;
                    if (rune >= 0xD800 && rune <= 0xDBFF && p->end - p->s >= 6 && p->s[0] == '\\' && p->s[1] == 'u') {
                        int lo = 0;
                        bool ok = true;
                        for (int i = 0; i < 4; i++) { int v = hexval(p->s[2 + i]); if (v < 0) { ok = false; break; } lo = (lo << 4) | v; }
                        if (ok && lo >= 0xDC00 && lo <= 0xDFFF) {
                            rune = 0x10000 + ((rune - 0xD800) << 10) + (lo - 0xDC00);
                            p->s += 6;
                        }
                    }
                    sb_put_rune(&b, rune);
                    break;
                }
                default: sb_free(&b); jfail(p);
            }
        } else {
            sb_putc(&b, c);
        }
    }
    sb_free(&b);
    jfail(p);
    deon_str e = {0};
    return e;
}

static deon_value *jvalue(jparser *p) {
    /* jvalue reaches p->depth == K + 1 for a value nested K enclosing values below the root, so this
     * refuses exactly the values guard_depth (stringifier.c) would — nothing that parses here can then
     * be rejected later at a writer. The +1 keeps the two counts aligned; DEON_MAX_DEPTH is the limit. */
    if (++p->depth > DEON_MAX_DEPTH + 1) jdepth(p);
    jws(p);
    if (p->s >= p->end) jfail(p);
    char c = *p->s;
    deon_value *result;

    if (c == '{') {
        p->s++;
        result = value_empty_map(p->ctx->a);
        jws(p);
        if (p->s < p->end && *p->s == '}') { p->s++; p->depth--; return result; }
        for (;;) {
            jws(p);
            deon_str key = jstring_raw(p);
            jws(p);
            if (p->s >= p->end || *p->s != ':') jfail(p);
            p->s++;
            deon_value *v = jvalue(p);
            map_set(p->ctx->a, result, key, v); /* last write wins, key moves (section 5) */
            jws(p);
            if (p->s < p->end && *p->s == ',') { p->s++; continue; }
            if (p->s < p->end && *p->s == '}') { p->s++; break; }
            jfail(p);
        }
    } else if (c == '[') {
        p->s++;
        result = value_empty_list(p->ctx->a);
        jws(p);
        if (p->s < p->end && *p->s == ']') { p->s++; p->depth--; return result; }
        for (;;) {
            deon_value *v = jvalue(p);
            list_push(p->ctx->a, result, v);
            jws(p);
            if (p->s < p->end && *p->s == ',') { p->s++; continue; }
            if (p->s < p->end && *p->s == ']') { p->s++; break; }
            jfail(p);
        }
    } else if (c == '"') {
        result = value_string(p->ctx->a, jstring_raw(p));
    } else if (c == 't') {
        if (p->end - p->s < 4 || strncmp(p->s, "true", 4) != 0) jfail(p);
        p->s += 4;
        result = value_string_cstr(p->ctx->a, "true");
    } else if (c == 'f') {
        if (p->end - p->s < 5 || strncmp(p->s, "false", 5) != 0) jfail(p);
        p->s += 5;
        result = value_string_cstr(p->ctx->a, "false");
    } else if (c == 'n') {
        if (p->end - p->s < 4 || strncmp(p->s, "null", 4) != 0) jfail(p);
        p->s += 4;
        result = value_string_cstr(p->ctx->a, "");
    } else if (c == '-' || (c >= '0' && c <= '9')) {
        const char *start = p->s;
        if (*p->s == '-') p->s++;
        while (p->s < p->end && ((*p->s >= '0' && *p->s <= '9') || *p->s == '.' ||
               *p->s == 'e' || *p->s == 'E' || *p->s == '+' || *p->s == '-')) p->s++;
        if (p->s == start || (p->s == start + 1 && *start == '-')) jfail(p);
        /* the source token spelling, verbatim */
        result = value_string(p->ctx->a, arena_str(p->ctx->a, start, (size_t)(p->s - start)));
    } else {
        jfail(p);
        result = NULL;
    }
    p->depth--;
    return result;
}

deon_value *json_to_value(deon_ctx *ctx, const char *data, size_t len, deon_span at) {
    jparser p;
    p.s = data;
    p.end = data + len;
    p.ctx = ctx;
    p.at = at;
    p.depth = 0;
    deon_value *v = jvalue(&p);
    jws(&p);
    if (p.s != p.end) jfail(&p);
    return v;
}
