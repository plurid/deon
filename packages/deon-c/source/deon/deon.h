#ifndef DEON_DEON_H
#define DEON_DEON_H

/*
 * The public surface of the C implementation of Deon.
 *
 * A Deon value is exactly one of three things — a string, an ordered list, or an ordered map. There is
 * no null, no boolean, and no number in the data model; the DEON_BOOL and DEON_NUMBER kinds exist only
 * as the output of the conservative typer (section 14), which is a view of a value rather than a value.
 *
 * Memory is owned by a deon_document: one arena holds a whole parse — every node, value, and string —
 * and deon_document_free releases all of it at once. A value handed back by deon_document_root lives as
 * long as the document that produced it and not a moment longer.
 */

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

/* The fourteen diagnostic codes, and there are no others (diagnostics.md). The catalogue is closed. */
typedef enum {
    DEON_OK = 0,
    DEON_LEX_UNTERMINATED,
    DEON_LEX_INVALID,
    DEON_PARSE_EXPECTED,
    DEON_PARSE_ROOT,
    DEON_DUPLICATE_DECLARATION,
    DEON_UNRESOLVED_LINK,
    DEON_CYCLE,
    DEON_STRUCTURE_ARITY,
    DEON_ENTITY_ARGUMENT,
    DEON_TYPE_MISMATCH,
    DEON_CAPABILITY_DENIED,
    DEON_RESOURCE_IO,
    DEON_RESOURCE_FORMAT,
    DEON_LINT_DUPLICATE_KEY
} deon_code;

/* The wire name of a code, as it appears in a fixture, a tool's output, and a host's log. */
const char *deon_code_name(deon_code code);

/* A string: a pointer, a length, and a NUL one past the end for C interop. Deon strings are UTF-8 and
 * may in principle carry an embedded NUL, so the length is authoritative and the terminator is a
 * convenience, never the measure. */
typedef struct {
    char  *data;
    size_t len;
} deon_str;

typedef enum {
    DEON_STRING,
    DEON_LIST,
    DEON_MAP,
    DEON_BOOL,   /* typer output only */
    DEON_NUMBER  /* typer output only */
} deon_kind;

typedef struct deon_value deon_value;

typedef struct {
    deon_value **items;
    size_t       len;
    size_t       cap;
} deon_list;

/* An ordered map. A rewritten key moves to its final write position (section 5), so this is a pair of
 * parallel arrays with a move-on-rewrite insert, never a hash table that would forget the order. */
typedef struct {
    deon_str    *keys;
    deon_value **values;
    size_t       len;
    size_t       cap;
} deon_map;

struct deon_value {
    deon_kind kind;
    union {
        deon_str  string;  /* DEON_STRING; for DEON_NUMBER, the source spelling */
        deon_list list;
        deon_map  map;
        bool      boolean;
        double    number;
    } as;
};

/* Span is where a diagnostic points. Start and End are UTF-8 byte offsets; Line and Column are
 * one-based and counted in Unicode code points. The two are different numbers, and conflating them is
 * the classic way to underline the wrong character. */
typedef struct {
    const char *source;
    size_t      start;
    size_t      end;
    int         line;
    int         column;
    int         end_line;
    int         end_column;
} deon_span;

typedef struct {
    deon_code code;
    deon_str  message;
    deon_span span;
    int       severity; /* 0 = error, 1 = warning */
} deon_diagnostic;

typedef struct {
    deon_code        code;
    deon_str         message;
    deon_diagnostic *diagnostics;
    size_t           diagnostics_len;
} deon_error;

/* A single (key, value) pair, for the resource and absolute-path maps a caller supplies. */
typedef struct {
    const char *key;
    const char *value;
} deon_pair;

typedef struct {
    const char *source_name;
    const char *filebase;

    const deon_pair *resources;      /* consulted before any loader */
    size_t           resources_len;

    const deon_pair *absolute_paths; /* logical target -> host path */
    size_t           absolute_paths_len;

    const deon_pair *environment;    /* what #$NAME reads; empty by default, never the process env */
    size_t           environment_len;

    const deon_pair *authorization;  /* bearer token per lowercase hostname */
    size_t           authorization_len;

    const char *token;               /* the credential parse-link fetches with */

    bool allow_filesystem;
    bool allow_network;

    bool        cache;
    int         cache_duration;      /* milliseconds; 0 means the default (one hour) */
    const char *cache_directory;     /* NULL means ~/.deon-cache */

    const char *const *datasign_files;
    size_t             datasign_files_len;
    const deon_pair   *datasign_map;
    size_t             datasign_map_len;
} deon_options;

typedef struct {
    bool canonical;
    bool readable;
    int  indentation;
    bool leaflinks;
    int  leaflink_level;
    bool leaflink_shortening;
    bool generated_header;
    bool generated_comments;
} deon_stringify_options;

deon_stringify_options deon_default_stringify_options(void);

/* A parsed document. It owns the arena that holds its value or its error. */
typedef struct deon_document deon_document;

#define DEON_VERSION "0.0.0-11"

/* #region reading */
deon_document *deon_parse(const char *source, size_t len);
deon_document *deon_parse_with(const char *source, size_t len, const deon_options *options);
deon_document *deon_parse_file(const char *path, const deon_options *options);
deon_document *deon_read_json(const char *source, size_t len, const char *source_name);
deon_document *deon_parse_link(const char *link, const deon_options *options);

/* deon_read_file loads a document as text, turning a failure into DEON_RESOURCE_IO rather than a host
 * error. The returned buffer is malloc'd; the caller frees it. On failure it returns NULL and, when
 * error is non-NULL, fills a code. */
char *deon_read_file(const char *path, size_t *out_len, deon_code *error);

bool               deon_document_ok(const deon_document *document);
const deon_error  *deon_document_error(const deon_document *document);
deon_value        *deon_document_root(const deon_document *document);
void               deon_document_free(deon_document *document);
/* #endregion reading */

/* #region syntactic queries (no evaluation) */
typedef struct {
    deon_str    name;
    deon_str   *parameters;
    size_t      parameters_len;
    const char *kind; /* "resource" | "map" | "list" | "structure" | "link" | "call" | "scalar" */
} deon_entity;

/* deon_entities and deon_lint allocate into the document's arena. deon_lint returns diagnostics that
 * are advice rather than refusal; it never fails. */
deon_document *deon_lint_document(const char *source, size_t len, const char *source_name,
                                  const deon_diagnostic **out, size_t *out_len);
deon_document *deon_entities(const char *source, size_t len, const char *source_name,
                             const deon_entity **out, size_t *out_len);
/* #endregion */

/* #region writing (results are malloc'd; the caller frees)
 * A value built by hand rather than parsed can nest past the limit the parser enforces (DEON_MAX_DEPTH).
 * When it does, these return NULL and, if error is non-NULL, set it to DEON_PARSE_EXPECTED; on success
 * they set *error to DEON_OK. Pass NULL for error to ignore it. */
char *deon_stringify(const deon_value *value, const deon_stringify_options *options, size_t *out_len, deon_code *error);
char *deon_canonical(const deon_value *value, size_t *out_len, deon_code *error);
/* #endregion */

/* #region typing (allocates into the given document's arena)
 * Returns NULL and sets *error to DEON_PARSE_EXPECTED when the value nests past the limit; otherwise sets
 * *error to DEON_OK. Pass NULL for error to ignore it. */
deon_value *deon_typed(deon_document *document, const deon_value *value, deon_code *error);
/* #endregion */

/* value helpers */
bool        deon_value_equal(const deon_value *a, const deon_value *b);
deon_value *deon_map_get(const deon_value *map, const char *key);

#endif
