#ifndef DEON_INTERNAL_H
#define DEON_INTERNAL_H

#include "deon.h"

#include <setjmp.h>

/* #region arena
 * A bump allocator. Every node, value, and string of one operation is allocated from a single arena
 * and freed together, which removes the whole class of per-node lifetime bugs: nothing is freed twice,
 * nothing outlives its owner, and a longjmp out of a deeply recursive parser leaks nothing. */
typedef struct arena arena;

arena *arena_new(void);
void   arena_free(arena *a);
void  *arena_alloc(arena *a, size_t size);
char  *arena_memdup(arena *a, const char *data, size_t len); /* NUL-terminated copy */
deon_str arena_str(arena *a, const char *data, size_t len);
deon_str arena_str_cstr(arena *a, const char *cstr);
/* #endregion */

/* #region string builder (malloc-backed, grows; used for decoded strings and stringifier output) */
typedef struct {
    char  *data;
    size_t len;
    size_t cap;
} sb;

void  sb_reserve(sb *b, size_t extra);
void  sb_putc(sb *b, char c);
void  sb_put(sb *b, const char *data, size_t len);
void  sb_puts(sb *b, const char *cstr);
void  sb_put_rune(sb *b, uint32_t rune);
char *sb_finish(sb *b, size_t *out_len); /* hands ownership to the caller, resets the builder */
void  sb_free(sb *b);
deon_str sb_into_arena(sb *b, arena *a); /* copies into the arena, frees the builder */
/* #endregion */

/* #region error context
 * fail() records a diagnostic and longjmps to the nearest boundary. Nothing but a Deon diagnostic is
 * raised this way; a genuine allocation failure aborts rather than masquerading as a bad document. */
typedef struct {
    arena          *a;
    jmp_buf         jmp;
    deon_code       code;
    deon_str        message;
    deon_span       span;
    /* A secondary position the reader is sent to (diagnostics.md), carried through the longjmp alongside
     * the primary span. has_related is false for every diagnostic but the few that point elsewhere — a
     * fresh ctx is zero-initialized, and deon_fail clears it, so only deon_fail_related sets it. */
    deon_span       related;
    bool            has_related;
    deon_diagnostic extra[8]; /* import-trace frames, if any */
    size_t          extra_len;
    /* §11.2: while a string is being decoded, interp_anchor holds the start of the string that carries
     * the interpolation. A malformed reference inside `#{ ... }` has no source position of its own — it
     * was recovered by decoding — so its diagnostic is reported here, at the carrying string, rather than
     * at a position inside it. interp_anchor_set is true only during that decode. */
    deon_span       interp_anchor;
    bool            interp_anchor_set;
} deon_ctx;

void deon_fail(deon_ctx *ctx, deon_code code, const char *message, deon_span span);
/* Like deon_fail, but the diagnostic also carries a related span — a secondary source position the
 * reader is sent to (diagnostics.md), such as the first declaration a duplicate collides with. */
void deon_fail_related(deon_ctx *ctx, deon_code code, const char *message, deon_span span, deon_span related);
/* #endregion */

/* #region UTF-8 */
/* utf8_decode reads one code point at s (up to end), returns it and advances *len to its byte width.
 * An invalid sequence decodes to U+FFFD with width 1, which keeps the reader total. */
uint32_t utf8_decode(const char *s, const char *end, int *width);
int      utf8_width(uint32_t rune);
void     utf8_encode(uint32_t rune, sb *b);
bool     utf8_valid(const char *s, size_t len);
/* A control code point with no literal form in Deon source (section 4.3): a C0 control other than a
 * horizontal tab, a line feed, and a carriage return; a DEL (U+007F); or a C1 control (U+0080–U+009F).
 * Written raw it is a lexical error; written back it takes a `\u{…}` escape. */
bool     is_control_rune(uint32_t cp);
/* #endregion */

/* #region syntax tree */
typedef struct access_seg {
    deon_str  name;
    long long index;   /* a list index, held in 64 bits so a large one is not truncated; -1 marks out of range */
    bool      by_index;
} access_seg;

typedef struct {
    bool        env;   /* #$NAME */
    deon_str    head;
    access_seg *access;
    size_t      access_len;
    deon_span   span;
} reference;

typedef struct {
    bool      is_interp;
    deon_str  literal;
    reference interp;
} string_part;

typedef struct node node;

typedef struct {
    reference *spread; /* non-NULL => ...#ref */
    deon_str   key;
    deon_span  key_span;
    node      *value;
    bool       has_value;
} map_entry;

typedef struct {
    reference *spread;
    node      *value;
} list_item;

typedef struct {
    deon_str  name;
    deon_span name_span;
    node     *value;
} call_arg;

typedef enum {
    NODE_SCALAR, NODE_MAP, NODE_LIST, NODE_STRUCTURE, NODE_LINK, NODE_CALL
} node_kind;

struct node {
    node_kind kind;
    deon_span span;
    union {
        struct { string_part *parts; size_t len; } scalar;
        struct { map_entry *entries; size_t len; } map;
        struct { list_item *items; size_t len; } list;
        struct {
            deon_str  *fields;
            size_t     fields_len;
            node     **cells;   /* flat: row i, column j at cells[i*fields_len + j] */
            size_t     rows_len;
            deon_span *row_spans;
        } structure;
        struct { reference ref; } link;
        struct {
            reference  ref;
            call_arg  *args;
            size_t     args_len;
            deon_span  args_span; /* the opening '(' */
        } call;
    } as;
};

typedef enum { DECL_LEAFLINK, DECL_IMPORT, DECL_INJECT } decl_kind;

typedef struct {
    decl_kind kind;
    deon_str  name;
    deon_span name_span;
    deon_span span;
    node     *value;         /* leaflink */
    deon_str  target;        /* import / inject */
    node     *authenticator; /* may be NULL */
} declaration;

typedef struct {
    declaration *decls;
    size_t       decls_len;
    node        *root;
    deon_span    root_span;
    bool         has_root;
} document_ast;
/* #endregion */

/* #region parser */
#define DEON_MAX_DEPTH 128

typedef struct {
    const char *bytes;    /* the normalized (CRLF-folded) source, which byte_off indexes */
    uint32_t   *runes;
    size_t      count;
    size_t     *byte_off; /* [count+1] */
    int        *line;     /* [count+1] */
    int        *col;      /* [count+1] */
    const char *source_name;
    size_t      pos;
    int         depth;
    deon_ctx   *ctx;
} parser;

document_ast *parse_document(deon_ctx *ctx, const char *text, size_t len, const char *source_name);
/* #endregion */

/* #region value construction */
deon_value *value_string(arena *a, deon_str s);
deon_value *value_string_cstr(arena *a, const char *s);
deon_value *value_bool(arena *a, bool b);
deon_value *value_number(arena *a, double n);
deon_value *value_empty_map(arena *a);
deon_value *value_empty_list(arena *a);
void        map_set(arena *a, deon_value *map, deon_str key, deon_value *value); /* move-on-rewrite */
bool        map_get(const deon_value *map, deon_str key, deon_value **out);
void        list_push(arena *a, deon_value *list, deon_value *value);
/* #endregion */

/* #region evaluation, resources, json, typing, datasign, lint, stringify */
struct deon_document {
    arena       *a;
    bool         ok;
    deon_value  *root;
    deon_error   error;
    /* scratch used by entities/lint accessor forms */
    deon_entity     *entities;
    size_t           entities_len;
    deon_diagnostic *lint;
    size_t           lint_len;
};

typedef struct interpreter interpreter;

deon_value *evaluate(deon_ctx *ctx, document_ast *doc, const deon_options *options);
deon_value *json_to_value(deon_ctx *ctx, const char *data, size_t len, deon_span at);
deon_value *sign_value(deon_ctx *ctx, deon_value *root, const deon_options *options);
deon_value *type_value(arena *a, const deon_value *value);

void   lint_document(deon_ctx *ctx, document_ast *doc, deon_diagnostic **out, size_t *out_len);
char  *stringify_value(const deon_value *value, const deon_stringify_options *options, size_t *out_len);

/* guard_depth walks a host-built value iteratively (never recursing) and returns false when it nests
 * deeper than DEON_MAX_DEPTH, matching the limit the parser enforces (section 11.1). The public writers
 * and the typer run it before any recursive pass. */
bool   guard_depth(const deon_value *root);

/* interpolation parameter names of an entity body (its exact parameter set). */
void interpolation_names(node *n, arena *a, deon_str **out, size_t *out_len);

/* network + cache (network.c, cache.c) */
deon_str http_get(deon_ctx *ctx, const char *target, const char *kind, const char *token, deon_span span);
bool     cache_read(const deon_options *options, const char *name, const char *token, arena *a, deon_str *out);
void     cache_write(const deon_options *options, const char *name, const char *token, deon_str body);

/* small helpers */
bool     str_eq(deon_str a, const char *b);
bool     str_eq_str(deon_str a, deon_str b);
deon_span span_head(const char *source_name);
/* #endregion */

#endif
