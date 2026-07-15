#include "parser_internal.h"

#include <errno.h>
#include <string.h>
#include <stdlib.h>

/* A scannerless recursive-descent parser over the code-point stream. There is no separate token list:
 * Deon is context-sensitive — a '#' begins a link at a value position and is ordinary text inside a
 * word, a '.' navigates a reference and is ordinary inside an unquoted string — and a parser that
 * knows its context decides those without a lexer having to guess. */

/* #region setup */
static parser *parser_new(deon_ctx *ctx, const char *text, size_t len, const char *source_name) {
    /* CRLF folds to LF before anything else (section 4.1), so every offset indexes the normalized
     * source. */
    char *norm = arena_alloc(ctx->a, len + 1);
    size_t nlen = 0;
    for (size_t i = 0; i < len; i++) {
        if (text[i] == '\r' && i + 1 < len && text[i + 1] == '\n') continue;
        norm[nlen++] = text[i];
    }
    norm[nlen] = '\0';

    /* Count code points. */
    size_t count = 0;
    for (size_t i = 0; i < nlen;) {
        int w;
        utf8_decode(norm + i, norm + nlen, &w);
        i += w;
        count++;
    }

    parser *p = arena_alloc(ctx->a, sizeof(*p));
    p->bytes = norm;
    p->runes = arena_alloc(ctx->a, count * sizeof(uint32_t) + 1);
    p->byte_off = arena_alloc(ctx->a, (count + 1) * sizeof(size_t));
    p->line = arena_alloc(ctx->a, (count + 1) * sizeof(int));
    p->col = arena_alloc(ctx->a, (count + 1) * sizeof(int));
    p->count = count;
    p->source_name = source_name;
    p->pos = 0;
    p->depth = 0;
    p->ctx = ctx;

    size_t off = 0;
    int line = 1, col = 1;
    size_t idx = 0;
    for (size_t i = 0; i < nlen;) {
        int w;
        uint32_t r = utf8_decode(norm + i, norm + nlen, &w);
        p->runes[idx] = r;
        p->byte_off[idx] = off;
        p->line[idx] = line;
        p->col[idx] = col;
        off += w;
        if (r == '\n') { line++; col = 1; } else { col++; }
        i += w;
        idx++;
    }
    p->byte_off[count] = off;
    p->line[count] = line;
    p->col[count] = col;
    return p;
}
/* #endregion */

/* #region cursor */
static bool at_end(parser *p) { return p->pos >= p->count; }

static uint32_t peek(parser *p) { return p->pos >= p->count ? 0 : p->runes[p->pos]; }

uint32_t peek_at(parser *p, int offset) {
    long i = (long)p->pos + offset;
    if (i < 0 || (size_t)i >= p->count) return 0;
    return p->runes[i];
}

static uint32_t advance(parser *p) {
    uint32_t r = peek(p);
    p->pos++;
    return r;
}

static bool starts_with(parser *p, const char *prefix) {
    for (int i = 0; prefix[i]; i++) {
        if (peek_at(p, i) != (uint32_t)(unsigned char)prefix[i]) return false;
    }
    return true;
}

deon_span span_at(parser *p, size_t pos) {
    if (pos > p->count) pos = p->count;
    deon_span s;
    s.source = p->source_name;
    s.start = p->byte_off[pos];
    s.end = p->byte_off[pos];
    s.line = p->line[pos];
    s.column = p->col[pos];
    s.end_line = p->line[pos];
    s.end_column = p->col[pos];
    return s;
}

static deon_span point(parser *p) { return span_at(p, p->pos); }

static deon_span span_between(parser *p, size_t start, size_t end) {
    deon_span s;
    s.source = p->source_name;
    s.start = p->byte_off[start];
    s.end = p->byte_off[end];
    s.line = p->line[start];
    s.column = p->col[start];
    s.end_line = p->line[end];
    s.end_column = p->col[end];
    return s;
}

/* the raw normalized bytes spanned by runes [start,end) */
deon_str slice(parser *p, size_t start, size_t end) {
    size_t a = p->byte_off[start], b = p->byte_off[end];
    deon_str s;
    s.data = (char *)p->bytes + a;
    s.len = b - a;
    return s;
}
/* #endregion */

/* #region character classes */
bool is_space(uint32_t r) { return r == ' ' || r == '\t'; }
bool is_newline(uint32_t r) { return r == '\n'; }

bool is_delimiter(uint32_t r) {
    switch (r) {
        case '{': case '}': case '[': case ']':
        case '(': case ')': case '<': case '>':
        case '\'': case '`':
            return true;
        default:
            return false;
    }
}

bool is_hard_delimiter(uint32_t r) {
    switch (r) {
        case '{': case '}': case '[': case ']':
        case '(': case ')': case '<': case '>':
            return true;
        default:
            return false;
    }
}

static bool word_stop(parser *p, uint32_t r) {
    (void)p;
    return r == 0 || is_space(r) || is_newline(r) || r == ',' || is_delimiter(r);
}

bool is_name_char(uint32_t r) {
    return (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') ||
           (r >= '0' && r <= '9') || r == '_' || r == '-';
}

bool is_digit(uint32_t r) { return r >= '0' && r <= '9'; }
/* #endregion */

/* #region trivia */
static void consume_line_comment(parser *p) {
    advance(p);
    advance(p);
    while (!at_end(p) && !is_newline(peek(p))) advance(p);
}

static void consume_block_comment(parser *p) {
    size_t start = p->pos;
    advance(p);
    advance(p);
    while (!at_end(p)) {
        if (peek(p) == '*' && peek_at(p, 1) == '/') {
            advance(p);
            advance(p);
            return;
        }
        advance(p);
    }
    deon_fail(p->ctx, DEON_LEX_UNTERMINATED, "A block comment was opened and never closed.", span_at(p, start));
}

void skip_inline(parser *p) {
    for (;;) {
        if (is_space(peek(p))) advance(p);
        else if (starts_with(p, "//")) consume_line_comment(p);
        else if (starts_with(p, "/*")) consume_block_comment(p);
        else return;
    }
}

static void skip_trivia(parser *p) {
    for (;;) {
        if (is_space(peek(p)) || is_newline(peek(p))) advance(p);
        else if (starts_with(p, "//")) consume_line_comment(p);
        else if (starts_with(p, "/*")) consume_block_comment(p);
        else return;
    }
}
/* #endregion */

/* forward decls */
static node *parse_value(parser *p);
static node *parse_map(parser *p);
static node *parse_list(parser *p);
static node *parse_structure(parser *p);
static node *parse_link_or_call(parser *p);
static reference parse_reference(parser *p);
static deon_str parse_name(parser *p, deon_span *span);
static void required_space(parser *p);
static bool entry_separator(parser *p, uint32_t closing);
static void expect(parser *p, uint32_t r, const char *message);

/* #region names */
static deon_str parse_name(parser *p, deon_span *span) {
    size_t start = p->pos;
    if (peek(p) == '\'') {
        size_t len;
        string_part *parts = parse_single_string(p, &len);
        if (span) *span = span_between(p, start, p->pos);
        return literal_of(p, parts, len);
    }
    while (!word_stop(p, peek(p))) advance(p);
    if (p->pos == start) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "A name was expected here.", point(p));
    }
    deon_str word = slice(p, start, p->pos);
    /* A bare word that is a valid string but not a valid name — a.b — is DEON_LEX_INVALID at the start
     * of the word, because what is wrong is the sequence, not the absence of something wanted. */
    for (size_t i = 0; i < p->pos - start; i++) {
        if (!is_name_char(p->runes[start + i])) {
            deon_fail(p->ctx, DEON_LEX_INVALID,
                      "This is not a valid name: a name is letters, digits, '_', and '-'.",
                      span_at(p, start));
        }
    }
    if (span) *span = span_between(p, start, p->pos);
    return arena_str(p->ctx->a, word.data, word.len);
}

static void required_space(parser *p) {
    if (!is_space(peek(p))) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "A space was expected here.", point(p));
    }
    skip_inline(p);
}
/* #endregion */

/* #region document */
static bool consumed_keyword(parser *p, const char *word) {
    int n = (int)strlen(word);
    for (int i = 0; i < n; i++) {
        if (peek_at(p, i) != (uint32_t)(unsigned char)word[i]) return false;
    }
    if (!is_space(peek_at(p, n))) return false;
    p->pos += n;
    skip_inline(p);
    return true;
}

static deon_str target_word(parser *p) {
    skip_inline(p);
    if (peek(p) == '\'') {
        size_t len;
        string_part *parts = parse_single_string(p, &len);
        return literal_of(p, parts, len);
    }
    size_t start = p->pos;
    while (!word_stop(p, peek(p))) advance(p);
    if (p->pos == start) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "An import or injection needs a target.", point(p));
    }
    return arena_str(p->ctx->a, slice(p, start, p->pos).data, p->byte_off[p->pos] - p->byte_off[start]);
}

static declaration parse_resource(parser *p, decl_kind kind, size_t start) {
    declaration d;
    memset(&d, 0, sizeof(d));
    d.kind = kind;
    d.name = parse_name(p, &d.name_span);
    required_space(p);
    if (!consumed_keyword(p, "from")) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "An import or injection needs 'from' before its target.", point(p));
    }
    d.target = target_word(p);

    size_t save = p->pos;
    skip_inline(p);
    if (consumed_keyword(p, "with")) {
        d.authenticator = parse_value(p);
    } else {
        p->pos = save;
    }
    d.span = span_between(p, start, p->pos);
    return d;
}

static declaration parse_leaflink(parser *p) {
    size_t start = p->pos;
    declaration d;
    memset(&d, 0, sizeof(d));
    d.kind = DECL_LEAFLINK;
    d.name = parse_name(p, &d.name_span);
    required_space(p);
    d.value = parse_value(p);
    d.span = span_between(p, start, p->pos);
    return d;
}

document_ast *parse_document(deon_ctx *ctx, const char *text, size_t len, const char *source_name) {
    parser *p = parser_new(ctx, text, len, source_name);
    document_ast *doc = arena_alloc(ctx->a, sizeof(*doc));

    /* grow declarations dynamically */
    size_t cap = 8;
    doc->decls = arena_alloc(ctx->a, cap * sizeof(declaration));
    doc->decls_len = 0;

    skip_trivia(p);
    while (!at_end(p)) {
        size_t start = p->pos;
        declaration d;
        bool have_decl = false;
        if (consumed_keyword(p, "import")) {
            d = parse_resource(p, DECL_IMPORT, start);
            have_decl = true;
        } else if (consumed_keyword(p, "inject")) {
            d = parse_resource(p, DECL_INJECT, start);
            have_decl = true;
        } else if (peek(p) == '{' || peek(p) == '[') {
            if (doc->has_root) {
                deon_fail(ctx, DEON_PARSE_ROOT, "A document has exactly one root, and this is a second.", point(p));
            }
            doc->root_span = point(p);
            doc->root = parse_value(p);
            doc->has_root = true;
        } else {
            d = parse_leaflink(p);
            have_decl = true;
        }
        if (have_decl) {
            if (doc->decls_len == cap) {
                cap *= 2;
                declaration *bigger = arena_alloc(ctx->a, cap * sizeof(declaration));
                memcpy(bigger, doc->decls, doc->decls_len * sizeof(declaration));
                doc->decls = bigger;
            }
            doc->decls[doc->decls_len++] = d;
        }
        skip_trivia(p);
    }

    if (!doc->has_root) {
        deon_fail(ctx, DEON_PARSE_ROOT, "A document must have a root map or list, and this has neither.", point(p));
    }
    return doc;
}
/* #endregion */

/* #region values */
static node *new_node(parser *p, node_kind kind) {
    node *n = arena_alloc(p->ctx->a, sizeof(*n));
    n->kind = kind;
    return n;
}

static node *empty_scalar(parser *p) {
    node *n = new_node(p, NODE_SCALAR);
    string_part *parts = arena_alloc(p->ctx->a, sizeof(string_part));
    parts[0].is_interp = false;
    parts[0].literal = arena_str(p->ctx->a, "", 0);
    n->as.scalar.parts = parts;
    n->as.scalar.len = 1;
    n->span = point(p);
    return n;
}

static node *parse_value(parser *p) {
    if (p->depth > DEON_MAX_DEPTH) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "The document nests more deeply than the parser will follow.", point(p));
    }
    p->depth++;
    node *result;
    uint32_t c = peek(p);
    if (c == '{') result = parse_map(p);
    else if (c == '[') result = parse_list(p);
    else if (c == '<') result = parse_structure(p);
    /* A bare `#` begins a link or call; `#{` is the interpolation opener of an unquoted string and may
     * open a value (section 4.3), so it falls through to parse_unquoted. */
    else if (c == '#' && !starts_with(p, "#{")) result = parse_link_or_call(p);
    else if (c == '\'') {
        size_t start = p->pos, len;
        string_part *parts = parse_single_string(p, &len);
        result = new_node(p, NODE_SCALAR);
        result->as.scalar.parts = parts;
        result->as.scalar.len = len;
        result->span = span_between(p, start, p->pos);
    } else if (c == '`') {
        size_t start = p->pos, len;
        string_part *parts = parse_backtick_string(p, &len);
        result = new_node(p, NODE_SCALAR);
        result->as.scalar.parts = parts;
        result->as.scalar.len = len;
        result->span = span_between(p, start, p->pos);
    } else {
        result = parse_unquoted(p);
    }
    p->depth--;
    return result;
}

static reference *parse_spread_reference(parser *p);
static deon_str receiving_key(node *value);

static node *parse_map(parser *p) {
    size_t start = p->pos;
    advance(p); /* { */

    size_t cap = 8, len = 0;
    map_entry *entries = arena_alloc(p->ctx->a, cap * sizeof(map_entry));

    skip_trivia(p);
    while (!at_end(p) && peek(p) != '}') {
        map_entry e;
        memset(&e, 0, sizeof(e));
        if (starts_with(p, "...#")) {
            e.spread = parse_spread_reference(p);
        } else if (peek(p) == '#') {
            node *value = parse_link_or_call(p);
            e.key = receiving_key(value);
            e.value = value;
            e.has_value = true;
        } else {
            e.key = parse_name(p, &e.key_span);
            size_t save = p->pos;
            skip_inline(p);
            if (at_end(p) || peek(p) == ',' || is_newline(peek(p)) || peek(p) == '}') {
                p->pos = save;
                e.value = empty_scalar(p);
                e.has_value = false;
            } else {
                e.value = parse_value(p);
                e.has_value = true;
            }
        }
        if (len == cap) {
            cap *= 2;
            map_entry *bigger = arena_alloc(p->ctx->a, cap * sizeof(map_entry));
            memcpy(bigger, entries, len * sizeof(map_entry));
            entries = bigger;
        }
        entries[len++] = e;
        if (!entry_separator(p, '}')) break;
    }
    expect(p, '}', "A map opened with '{' must be closed with '}'.");

    node *n = new_node(p, NODE_MAP);
    n->as.map.entries = entries;
    n->as.map.len = len;
    n->span = span_between(p, start, p->pos);
    return n;
}

static node *parse_list(parser *p) {
    size_t start = p->pos;
    advance(p); /* [ */

    size_t cap = 8, len = 0;
    list_item *items = arena_alloc(p->ctx->a, cap * sizeof(list_item));

    skip_trivia(p);
    while (!at_end(p) && peek(p) != ']') {
        list_item it;
        memset(&it, 0, sizeof(it));
        if (starts_with(p, "...#")) {
            it.spread = parse_spread_reference(p);
        } else {
            it.value = parse_value(p);
        }
        if (len == cap) {
            cap *= 2;
            list_item *bigger = arena_alloc(p->ctx->a, cap * sizeof(list_item));
            memcpy(bigger, items, len * sizeof(list_item));
            items = bigger;
        }
        items[len++] = it;
        if (!entry_separator(p, ']')) break;
    }
    expect(p, ']', "A list opened with '[' must be closed with ']'.");

    node *n = new_node(p, NODE_LIST);
    n->as.list.items = items;
    n->as.list.len = len;
    n->span = span_between(p, start, p->pos);
    return n;
}

static node *parse_structure(parser *p) {
    size_t start = p->pos;
    advance(p); /* < */

    size_t fcap = 8, flen = 0;
    deon_str *fields = arena_alloc(p->ctx->a, fcap * sizeof(deon_str));

    skip_trivia(p);
    while (!at_end(p) && peek(p) != '>') {
        deon_str name = parse_name(p, NULL);
        if (flen == fcap) {
            fcap *= 2;
            deon_str *bigger = arena_alloc(p->ctx->a, fcap * sizeof(deon_str));
            memcpy(bigger, fields, flen * sizeof(deon_str));
            fields = bigger;
        }
        fields[flen++] = name;
        skip_inline(p);
        if (peek(p) == ',') advance(p);
        skip_trivia(p);
    }
    expect(p, '>', "A structure signature opened with '<' must be closed with '>'.");

    /* A field name may not repeat: two columns writing the same key would lose one. */
    for (size_t i = 0; i < flen; i++) {
        for (size_t j = i + 1; j < flen; j++) {
            if (str_eq_str(fields[i], fields[j])) {
                deon_fail(p->ctx, DEON_STRUCTURE_ARITY, "A structure field is named more than once.", span_at(p, start));
            }
        }
    }

    skip_trivia(p);
    expect(p, '[', "A structure signature must be followed by '[' and its rows.");

    size_t rcap = 8, rows = 0;
    node **cells = arena_alloc(p->ctx->a, rcap * flen * sizeof(node *));
    deon_span *row_spans = arena_alloc(p->ctx->a, rcap * sizeof(deon_span));

    skip_trivia(p);
    while (!at_end(p) && peek(p) != ']') {
        size_t row_start = p->pos;
        node *row_cells[256];
        size_t ncells = 0;
        row_cells[ncells++] = parse_value(p);
        skip_inline(p);
        while (peek(p) == ',') {
            advance(p);
            skip_trivia(p);
            if (ncells < 256) row_cells[ncells] = parse_value(p);
            ncells++;
            skip_inline(p);
        }
        if (ncells != flen) {
            deon_fail(p->ctx, DEON_STRUCTURE_ARITY, "A structure row does not match the signature arity.", span_at(p, start));
        }
        if (rows == rcap) {
            rcap *= 2;
            node **bc = arena_alloc(p->ctx->a, rcap * flen * sizeof(node *));
            memcpy(bc, cells, rows * flen * sizeof(node *));
            cells = bc;
            deon_span *bs = arena_alloc(p->ctx->a, rcap * sizeof(deon_span));
            memcpy(bs, row_spans, rows * sizeof(deon_span));
            row_spans = bs;
        }
        for (size_t j = 0; j < flen; j++) cells[rows * flen + j] = row_cells[j];
        row_spans[rows] = span_between(p, row_start, p->pos);
        rows++;
        skip_trivia(p);
    }
    expect(p, ']', "A structure's rows must be closed with ']'.");

    node *n = new_node(p, NODE_STRUCTURE);
    n->as.structure.fields = fields;
    n->as.structure.fields_len = flen;
    n->as.structure.cells = cells;
    n->as.structure.rows_len = rows;
    n->as.structure.row_spans = row_spans;
    n->span = span_between(p, start, p->pos);
    return n;
}

static bool entry_separator(parser *p, uint32_t closing) {
    skip_inline(p);
    if (peek(p) == closing || at_end(p)) return false;
    if (peek(p) != ',' && !is_newline(peek(p))) {
        /* A string opener where a separator was due: let the string reader run so an unterminated one
         * is reported as the lexical error it is, at its opening quote. */
        deon_span at = point(p);
        if (peek(p) == '\'') { size_t l; parse_single_string(p, &l); deon_fail(p->ctx, DEON_PARSE_EXPECTED, "Entries are separated by a comma or a newline.", at); }
        if (peek(p) == '`') { size_t l; parse_backtick_string(p, &l); deon_fail(p->ctx, DEON_PARSE_EXPECTED, "Entries are separated by a comma or a newline.", at); }
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "Entries are separated by a comma or a newline.", point(p));
    }
    for (;;) {
        if (peek(p) == ',') advance(p);
        else if (is_space(peek(p)) || is_newline(peek(p))) advance(p);
        else if (starts_with(p, "//")) consume_line_comment(p);
        else if (starts_with(p, "/*")) consume_block_comment(p);
        else return true;
    }
}

static void expect(parser *p, uint32_t r, const char *message) {
    if (peek(p) != r) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, message, point(p));
    }
    advance(p);
}
/* #endregion */

/* #region references */
static access_seg parse_bracket_access(parser *p);
static deon_str parse_bare_name(parser *p);
static call_arg *parse_call_arguments(parser *p, size_t *out_len);

static node *parse_link_or_call(parser *p) {
    size_t start = p->pos;
    advance(p); /* # */
    reference ref = parse_reference(p);
    if (peek(p) == '(') {
        deon_span args_span = point(p);
        size_t args_len;
        call_arg *args = parse_call_arguments(p, &args_len);
        node *n = new_node(p, NODE_CALL);
        n->as.call.ref = ref;
        n->as.call.args = args;
        n->as.call.args_len = args_len;
        n->as.call.args_span = args_span;
        n->span = span_between(p, start, p->pos);
        return n;
    }
    node *n = new_node(p, NODE_LINK);
    n->as.link.ref = ref;
    n->span = span_between(p, start, p->pos);
    return n;
}

static reference *parse_spread_reference(parser *p) {
    size_t start = p->pos;
    advance(p); advance(p); advance(p); advance(p); /* ...# */
    reference ref = parse_reference(p);
    ref.span = span_between(p, start, p->pos); /* anchored at the ... */
    reference *out = arena_alloc(p->ctx->a, sizeof(reference));
    *out = ref;
    return out;
}

static reference parse_reference(parser *p) {
    size_t start = p->pos;
    reference ref;
    memset(&ref, 0, sizeof(ref));

    if (peek(p) == '$') {
        advance(p);
        ref.env = true;
        ref.head = parse_bare_name(p);
        ref.span = span_between(p, start, p->pos);
        return ref;
    }

    if (peek(p) == '\'') {
        size_t len;
        string_part *parts = parse_single_string(p, &len);
        ref.head = literal_of(p, parts, len);
    } else {
        ref.head = parse_bare_name(p);
    }

    size_t acap = 4, alen = 0;
    access_seg *access = arena_alloc(p->ctx->a, acap * sizeof(access_seg));
    for (;;) {
        if (peek(p) == '.') {
            advance(p);
            access_seg seg;
            memset(&seg, 0, sizeof(seg));
            seg.name = parse_bare_name(p);
            if (alen == acap) { acap *= 2; access_seg *b = arena_alloc(p->ctx->a, acap * sizeof(access_seg)); memcpy(b, access, alen * sizeof(access_seg)); access = b; }
            access[alen++] = seg;
        } else if (peek(p) == '[') {
            advance(p);
            access_seg seg = parse_bracket_access(p);
            expect(p, ']', "A bracket access must be closed with ']'.");
            if (alen == acap) { acap *= 2; access_seg *b = arena_alloc(p->ctx->a, acap * sizeof(access_seg)); memcpy(b, access, alen * sizeof(access_seg)); access = b; }
            access[alen++] = seg;
        } else {
            break;
        }
    }
    ref.access = access;
    ref.access_len = alen;
    ref.span = span_between(p, start, p->pos);
    return ref;
}

static access_seg parse_bracket_access(parser *p) {
    access_seg seg;
    memset(&seg, 0, sizeof(seg));
    if (peek(p) == '\'') {
        size_t len;
        string_part *parts = parse_single_string(p, &len);
        seg.name = literal_of(p, parts, len);
        return seg;
    }
    size_t start = p->pos;
    bool digits = true;
    while (peek(p) != ']' && !word_stop(p, peek(p))) {
        if (!is_digit(peek(p))) digits = false;
        advance(p);
    }
    if (p->pos == start) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "A bracket access needs a name or an index.", span_at(p, start));
    }
    deon_str text = arena_str(p->ctx->a, slice(p, start, p->pos).data, p->byte_off[p->pos] - p->byte_off[start]);
    if (digits) {
        seg.by_index = true;
        /* Parse the index as a 64-bit integer. One that overflows even that, or that carries any
         * non-digit tail, cannot name a real position, so it is marked out of range (-1) rather than
         * truncated into a wrong-but-valid index — the interpreter then reports it the same way it
         * reports 5 on a three-item list (specification section 6). */
        errno = 0;
        char *tail = NULL;
        long long value = strtoll(text.data, &tail, 10);
        seg.index = (errno == ERANGE || tail == text.data || *tail != '\0' || value < 0) ? -1 : value;
        seg.name = text;
    } else {
        seg.name = text;
    }
    return seg;
}

static deon_str parse_bare_name(parser *p) {
    size_t start = p->pos;
    while (is_name_char(peek(p))) advance(p);
    if (p->pos == start) {
        deon_fail(p->ctx, DEON_PARSE_EXPECTED, "A reference name was expected here.", point(p));
    }
    return arena_str(p->ctx->a, slice(p, start, p->pos).data, p->byte_off[p->pos] - p->byte_off[start]);
}

static call_arg *parse_call_arguments(parser *p, size_t *out_len) {
    advance(p); /* ( */
    size_t cap = 4, len = 0;
    call_arg *args = arena_alloc(p->ctx->a, cap * sizeof(call_arg));
    skip_trivia(p);
    while (!at_end(p) && peek(p) != ')') {
        call_arg a;
        memset(&a, 0, sizeof(a));
        a.name = parse_name(p, &a.name_span);
        required_space(p);
        a.value = parse_value(p);
        if (len == cap) { cap *= 2; call_arg *b = arena_alloc(p->ctx->a, cap * sizeof(call_arg)); memcpy(b, args, len * sizeof(call_arg)); args = b; }
        args[len++] = a;
        if (!entry_separator(p, ')')) break;
    }
    expect(p, ')', "A call opened with '(' must be closed with ')'.");
    *out_len = len;
    return args;
}

static deon_str receiving_key(node *value) {
    reference ref;
    if (value->kind == NODE_LINK) ref = value->as.link.ref;
    else if (value->kind == NODE_CALL) ref = value->as.call.ref;
    else { deon_str e = {0}; return e; }
    if (ref.access_len > 0) return ref.access[ref.access_len - 1].name;
    return ref.head;
}
/* #endregion */

deon_str literal_of(parser *p, string_part *parts, size_t len) {
    sb b = {0};
    for (size_t i = 0; i < len; i++) {
        if (!parts[i].is_interp) sb_put(&b, parts[i].literal.data, parts[i].literal.len);
    }
    return sb_into_arena(&b, p->ctx->a);
}

parser *sub_parser(deon_ctx *ctx, const char *utf8, size_t len) {
    return parser_new(ctx, utf8, len, "");
}

/* One interpolation parsed on the current cursor: `#{ reference }`, returned as a part to resolve at
 * evaluation. Lives here because it reaches the reference parser. */
string_part parse_interpolation_part(parser *p) {
    advance(p); /* # */
    advance(p); /* { */
    reference ref = parse_reference(p);
    expect(p, '}', "An interpolation opened with '#{' must be closed with '}'.");
    string_part part;
    part.is_interp = true;
    memset(&part.literal, 0, sizeof(part.literal));
    part.interp = ref;
    return part;
}

/* Wrappers so strings.c can drive the same live cursor without the static names leaking globally. */
uint32_t  p_peek(parser *p)                         { return peek(p); }
uint32_t  p_advance(parser *p)                       { return advance(p); }
bool      p_at_end(parser *p)                        { return at_end(p); }
bool      p_starts_with(parser *p, const char *s)    { return starts_with(p, s); }
deon_span p_point(parser *p)                         { return point(p); }
deon_span p_span_between(parser *p, size_t s, size_t e) { return span_between(p, s, e); }
