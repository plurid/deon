#include "parser_internal.h"

#include <string.h>
#include <stdlib.h>

/* The three string forms of section 4.3, and the shared escape and interpolation decoding. Each form
 * collects the raw source it spans, then decodes that source once: escapes are read, `#{reference}` is
 * turned into a part, and the active quote delimiter is preserved verbatim. A single quote is confined
 * to one line; a backtick may span lines and trims its boundary whitespace; an unquoted string treats an
 * interior quote or `#` as ordinary literal text, ending only at an unnested comma, newline, bracketing
 * delimiter, or a link-starting `#` at a token boundary. */

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

    /* Collect the raw inner source, respecting escapes only enough to find the true close. The checked
     * string builder holds it, like every other allocation here, so an out-of-memory aborts cleanly
     * instead of dereferencing a NULL or leaking the original block on a failed grow. */
    sb raw = {0};
    for (;;) {
        if (p_at_end(p)) {
            sb_free(&raw);
            deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A backtick string was opened and never closed.", open);
        }
        uint32_t r = p_peek(p);
        if (r == '`') { p_advance(p); break; }
        if (r == '\\') {
            sb_put_rune(&raw, p_advance(p));
            if (p_at_end(p)) {
                sb_free(&raw);
                deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A backtick string ended in an unfinished escape.", open);
            }
            sb_put_rune(&raw, p_advance(p));
            continue;
        }
        sb_put_rune(&raw, p_advance(p));
    }

    /* Trim boundary whitespace of the source, before escapes are decoded: an escaped line break at an
     * edge is content and survives, where a real one is layout and does not. A backslash is not
     * whitespace, so \n written at an edge is kept. Every trimmable rune (space, tab, newline) is a
     * single ASCII byte and no byte of a UTF-8 multibyte sequence equals one, so trimming bytes at the
     * edges removes exactly the runes the rune-wise trim did. */
    size_t start = 0, end = raw.len;
    while (start < end && is_trimmable((unsigned char)raw.data[start])) start++;
    while (end > start && is_trimmable((unsigned char)raw.data[end - 1])) end--;

    string_part *parts = decode(p->ctx, raw.data ? raw.data + start : "", end - start, '`', out_len);
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

/* An unquoted string ends only at an unnested comma, a newline, a bracketing delimiter, or a
 * link-starting `#` at a token boundary. Section 4.3 makes an interior quote (`'` or backtick) and an
 * interior `#` ordinary literal text — they open nothing and end nothing — while `#{` is the
 * interpolation opener wherever it appears, including as the value's first character. */
node *parse_unquoted(parser *p) {
    size_t start = p->pos;
    sb raw = {0};

    while (!p_at_end(p)) {
        uint32_t r = p_peek(p);
        if (r == ',' || is_newline(r) || is_hard_delimiter(r)) break;

        /* `#{` is part of the value everywhere. A bare `#` at a token boundary would start a link, but
         * parse_value routes a value-initial `#` to the link parser and the after-whitespace boundary is
         * handled in the is_space branch below (via unquoted_continues), so here a bare `#` is always
         * interior and falls through to the literal writer at the foot of the loop. */
        if (p_starts_with(p, "#{")) { consume_interpolation_raw(p, &raw); continue; }

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
        if (r == '\\') {
            sb_put_rune(&raw, p_advance(p)); /* the backslash */
            if (!p_at_end(p)) {
                uint32_t n = p_peek(p);
                sb_put_rune(&raw, p_advance(p)); /* the escaped character */
                /* `\#{` is one escape that decodes to the literal `#{`. Its `{` is a bracketing
                 * delimiter, so the raw collector must take it here, or the loop would stop at the `{`
                 * and split the escape into `\#` and a stray `{`. decode reads the three bytes back. */
                if (n == '#' && !p_at_end(p) && p_peek(p) == '{') sb_put_rune(&raw, p_advance(p));
            }
            continue;
        }
        /* Any other rune — including an interior `'`, backtick, or bare `#` — is literal content. */
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
