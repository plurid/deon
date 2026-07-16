#include "internal.h"

#include <string.h>

static const char *const CODE_NAMES[] = {
    "DEON_OK",
    "DEON_LEX_UNTERMINATED",
    "DEON_LEX_INVALID",
    "DEON_PARSE_EXPECTED",
    "DEON_PARSE_ROOT",
    "DEON_DUPLICATE_DECLARATION",
    "DEON_UNRESOLVED_LINK",
    "DEON_CYCLE",
    "DEON_STRUCTURE_ARITY",
    "DEON_ENTITY_ARGUMENT",
    "DEON_TYPE_MISMATCH",
    "DEON_CAPABILITY_DENIED",
    "DEON_RESOURCE_IO",
    "DEON_RESOURCE_FORMAT",
    "DEON_LINT_DUPLICATE_KEY",
    "DEON_LIMIT_EXCEEDED",
};

const char *deon_code_name(deon_code code) {
    if (code < 0 || (size_t)code >= sizeof(CODE_NAMES) / sizeof(CODE_NAMES[0])) {
        return "DEON_OK";
    }
    return CODE_NAMES[code];
}

/* Every code is an error except the one that is advice. */
int deon_severity_of(deon_code code) {
    return code == DEON_LINT_DUPLICATE_KEY ? 1 : 0;
}

void deon_fail(deon_ctx *ctx, deon_code code, const char *message, deon_span span) {
    ctx->code = code;
    ctx->message = arena_str_cstr(ctx->a, message);
    ctx->span = span;
    ctx->has_related = false;
    longjmp(ctx->jmp, 1);
}

void deon_fail_related(deon_ctx *ctx, deon_code code, const char *message, deon_span span, deon_span related) {
    ctx->code = code;
    ctx->message = arena_str_cstr(ctx->a, message);
    ctx->span = span;
    ctx->related = related;
    ctx->has_related = true;
    longjmp(ctx->jmp, 1);
}

deon_span span_head(const char *source_name) {
    deon_span s;
    memset(&s, 0, sizeof(s));
    s.source = source_name;
    s.line = 1;
    s.column = 1;
    s.end_line = 1;
    s.end_column = 1;
    return s;
}

bool str_eq(deon_str a, const char *b) {
    size_t bl = strlen(b);
    return a.len == bl && memcmp(a.data, b, bl) == 0;
}

bool str_eq_str(deon_str a, deon_str b) {
    return a.len == b.len && memcmp(a.data, b.data, a.len) == 0;
}
