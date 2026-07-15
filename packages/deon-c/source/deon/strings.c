#include "parser_internal.h"

#include <string.h>
#include <stdlib.h>

/* The three string forms of section 4.3, and the shared escape and interpolation decoding. Each form
 * collects the raw source it spans, then decodes that source once: escapes are read, `#{reference}` is
 * turned into a part, and the active quote delimiter is preserved verbatim. A single quote is confined
 * to one line; a backtick may span lines and trims its boundary whitespace; an unquoted string keeps a
 * quote inside it as a literal region rather than ending at it. */

typedef struct {
    string_part *parts;
    size_t       len;
    size_t       cap;
    arena       *a;
} parts_builder;

static void push_part(parts_builder *b, string_part part) {
    if (b->len == b->cap) {
        size_t cap = b->cap ? b->cap * 2 : 4;
        string_part *bigger = arena_alloc(b->a, cap * sizeof(string_part));
        if (b->len) memcpy(bigger, b->parts, b->len * sizeof(string_part));
        b->parts = bigger;
        b->cap = cap;
    }
    b->parts[b->len++] = part;
}

static void flush_literal(parts_builder *b, sb *lit) {
    if (lit->len == 0) return;
    string_part part;
    part.is_interp = false;
    part.literal = arena_str(b->a, lit->data, lit->len);
    memset(&part.interp, 0, sizeof(part.interp));
    push_part(b, part);
    lit->len = 0;
}

/* decode reads an extracted run of source into parts, honoring escapes and interpolation. The active
 * quote delimiter — '\'' , '`', or 0 for an unquoted string — is what \' produces inside a single
 * string and preserves verbatim outside one. Every unnamed backslash sequence is kept literally. */
static string_part *decode(deon_ctx *ctx, const char *utf8, size_t len, uint32_t active, size_t *out_len) {
    parser *p = sub_parser(ctx, utf8, len);
    parts_builder b = {0};
    b.a = ctx->a;
    sb lit = {0};

    while (!p_at_end(p)) {
        uint32_t r = p_peek(p);
        if (r == '\\') {
            p_advance(p);
            if (p_at_end(p)) { sb_putc(&lit, '\\'); break; }
            uint32_t n = p_peek(p);
            if (n == '\\') { p_advance(p); sb_putc(&lit, '\\'); }
            else if (active != 0 && n == active) { p_advance(p); sb_put_rune(&lit, active); }
            else if (n == '#' && peek_at(p, 1) == '{') { p_advance(p); p_advance(p); sb_puts(&lit, "#{"); }
            else if (n == 'n') { p_advance(p); sb_putc(&lit, '\n'); }
            else if (n == 'r') { p_advance(p); sb_putc(&lit, '\r'); }
            else if (n == 't') { p_advance(p); sb_putc(&lit, '\t'); }
            else { p_advance(p); sb_putc(&lit, '\\'); sb_put_rune(&lit, n); }
        } else if (p_starts_with(p, "#{")) {
            flush_literal(&b, &lit);
            push_part(&b, parse_interpolation_part(p));
        } else {
            sb_put_rune(&lit, p_advance(p));
        }
    }
    flush_literal(&b, &lit);
    sb_free(&lit);

    if (b.len == 0) {
        string_part empty;
        empty.is_interp = false;
        empty.literal = arena_str(ctx->a, "", 0);
        memset(&empty.interp, 0, sizeof(empty.interp));
        push_part(&b, empty);
    }
    *out_len = b.len;
    return b.parts;
}

/* consume_interpolation_raw copies a `#{ ... }` opener and its reference into raw source, so the one
 * decode pass reads it as an interpolation; the quote characters inside it do not end the string. */
static void consume_interpolation_raw(parser *p, sb *raw) {
    deon_span open = p_point(p);
    sb_put_rune(raw, p_advance(p)); /* # */
    sb_put_rune(raw, p_advance(p)); /* { */
    for (;;) {
        if (p_at_end(p) || is_newline(p_peek(p))) {
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "An interpolation was opened and never closed.", open);
        }
        if (p_peek(p) == '}') { sb_put_rune(raw, p_advance(p)); return; }
        sb_put_rune(raw, p_advance(p));
    }
}

string_part *parse_single_string(parser *p, size_t *out_len) {
    deon_span open = p_point(p);
    p_advance(p); /* ' */
    sb raw = {0};
    for (;;) {
        if (p_at_end(p)) {
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A single-quoted string was opened and never closed.", open);
        }
        uint32_t r = p_peek(p);
        if (r == '\'') { p_advance(p); break; }
        if (is_newline(r)) {
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A single-quoted string may not cross a line.", open);
        }
        if (r == '\\') {
            sb_put_rune(&raw, p_advance(p));
            if (!p_at_end(p)) sb_put_rune(&raw, p_advance(p));
            continue;
        }
        if (p_starts_with(p, "#{")) { consume_interpolation_raw(p, &raw); continue; }
        sb_put_rune(&raw, p_advance(p));
    }
    string_part *parts = decode(p->ctx, raw.data ? raw.data : "", raw.len, '\'', out_len);
    sb_free(&raw);
    return parts;
}

static bool is_trimmable(uint32_t r) { return r == ' ' || r == '\t' || r == '\n'; }

string_part *parse_backtick_string(parser *p, size_t *out_len) {
    deon_span open = p_point(p);
    p_advance(p); /* ` */

    /* Collect the raw inner code points, respecting escapes only enough to find the true close. */
    size_t cap = 32, len = 0;
    uint32_t *runes = malloc(cap * sizeof(uint32_t));
    for (;;) {
        if (p_at_end(p)) {
            free(runes);
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A backtick string was opened and never closed.", open);
        }
        uint32_t r = p_peek(p);
        if (r == '`') { p_advance(p); break; }
        if (r == '\\') {
            if (len + 2 > cap) { cap *= 2; runes = realloc(runes, cap * sizeof(uint32_t)); }
            runes[len++] = p_advance(p);
            if (p_at_end(p)) {
                free(runes);
                deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A backtick string ended in an unfinished escape.", open);
            }
            runes[len++] = p_advance(p);
            continue;
        }
        if (len + 1 > cap) { cap *= 2; runes = realloc(runes, cap * sizeof(uint32_t)); }
        runes[len++] = p_advance(p);
    }

    /* Trim boundary whitespace of the source, before escapes are decoded: an escaped line break at an
     * edge is content and survives, where a real one is layout and does not. A backslash is not
     * whitespace, so \n written at an edge is kept. */
    size_t start = 0, end = len;
    while (start < end && is_trimmable(runes[start])) start++;
    while (end > start && is_trimmable(runes[end - 1])) end--;

    sb raw = {0};
    for (size_t i = start; i < end; i++) sb_put_rune(&raw, runes[i]);
    free(runes);

    string_part *parts = decode(p->ctx, raw.data ? raw.data : "", raw.len, '`', out_len);
    sb_free(&raw);
    return parts;
}

/* #region unquoted */
static bool unquoted_continues(parser *p) {
    if (p_at_end(p)) return false;
    uint32_t r = p_peek(p);
    if (r == ',' || is_newline(r) || is_hard_delimiter(r)) return false;
    if (r == '#' && peek_at(p, 1) != '{') return false;
    return true;
}

/* inter_word consumes the whitespace between two words, dropping any comment written in it and keeping
 * the surrounding spaces. A newline is not inter-word whitespace, so this stops at one. */
static void inter_word(parser *p, sb *out) {
    for (;;) {
        if (is_space(p_peek(p))) sb_put_rune(out, p_advance(p));
        else if (p_starts_with(p, "//")) { p_advance(p); p_advance(p); while (!p_at_end(p) && !is_newline(p_peek(p))) p_advance(p); }
        else if (p_starts_with(p, "/*")) {
            deon_span at = p_point(p);
            p_advance(p); p_advance(p);
            bool closed = false;
            while (!p_at_end(p)) { if (p_peek(p) == '*' && peek_at(p, 1) == '/') { p_advance(p); p_advance(p); closed = true; break; } p_advance(p); }
            if (!closed) deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A block comment was opened and never closed.", at);
        }
        else return;
    }
}

/* consume_quote_region copies a quoted region into an unquoted string's raw source, delimiters and
 * all, validating only that it is terminated. The content is decoded later along with the rest of the
 * value, so the quote marks survive as literal characters while an interpolation inside is still read. */
static void consume_quote_region(parser *p, sb *raw) {
    uint32_t quote = p_peek(p);
    deon_span open = p_point(p);
    sb_put_rune(raw, p_advance(p)); /* opening quote, kept literal */
    for (;;) {
        if (p_at_end(p)) {
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A string was opened and never closed.", open);
        }
        uint32_t r = p_peek(p);
        if (quote == '\'' && is_newline(r)) {
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A single-quoted string may not cross a line.", open);
        }
        if (r == '\\') {
            sb_put_rune(raw, p_advance(p));
            if (p_at_end(p)) {
                deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A string ended in an unfinished escape.", open);
            }
            sb_put_rune(raw, p_advance(p));
            continue;
        }
        if (r == quote) { sb_put_rune(raw, p_advance(p)); return; } /* closing quote, kept literal */
        sb_put_rune(raw, p_advance(p));
    }
}

node *parse_unquoted(parser *p) {
    size_t start = p->pos;
    sb raw = {0};

    while (!p_at_end(p)) {
        uint32_t r = p_peek(p);
        if (r == ',' || is_newline(r) || is_hard_delimiter(r)) break;
        /* A link (#name) is its own value and ends this one; an interpolation (#{) is part of it. */
        if (r == '#' && peek_at(p, 1) != '{') break;

        if (is_space(r)) {
            size_t save = p->pos;
            sb spaces = {0};
            inter_word(p, &spaces);
            if (unquoted_continues(p)) {
                sb_put(&raw, spaces.data ? spaces.data : "", spaces.len);
                sb_free(&spaces);
                continue;
            }
            sb_free(&spaces);
            p->pos = save;
            break;
        }
        if (r == '\'' || r == '`') { consume_quote_region(p, &raw); continue; }
        if (p_starts_with(p, "#{")) { consume_interpolation_raw(p, &raw); continue; }
        if (r == '\\') {
            sb_put_rune(&raw, p_advance(p));
            if (!p_at_end(p)) sb_put_rune(&raw, p_advance(p));
            continue;
        }
        sb_put_rune(&raw, p_advance(p));
    }

    if (raw.len == 0) {
        sb_free(&raw);
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "A value was expected here.", span_at(p, start));
    }
    size_t parts_len;
    string_part *parts = decode(p->ctx, raw.data, raw.len, 0, &parts_len);
    sb_free(&raw);

    node *n = arena_alloc(p->ctx->a, sizeof(node));
    n->kind = NODE_SCALAR;
    n->as.scalar.parts = parts;
    n->as.scalar.len = parts_len;
    n->span = p_span_between(p, start, p->pos);
    return n;
}
/* #endregion */
