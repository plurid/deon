#ifndef DEON_PARSER_INTERNAL_H
#define DEON_PARSER_INTERNAL_H

#include "internal.h"

/* Cursor primitives shared between parser.c and strings.c. Deon's strings are context-sensitive, so
 * the string reader runs on the same live cursor as the grammar rather than on a token stream. */

uint32_t p_peek(parser *p);
uint32_t peek_at(parser *p, int offset);
uint32_t p_advance(parser *p);
bool     p_at_end(parser *p);
bool     p_starts_with(parser *p, const char *prefix);

deon_span span_at(parser *p, size_t pos);
deon_span p_point(parser *p);
deon_span p_span_between(parser *p, size_t start, size_t end);
deon_str  slice(parser *p, size_t start, size_t end);

bool is_space(uint32_t r);
bool is_newline(uint32_t r);
bool is_delimiter(uint32_t r);
bool is_hard_delimiter(uint32_t r);
bool is_name_char(uint32_t r);
bool is_digit(uint32_t r);

void skip_inline(parser *p);

/* strings.c entry points used by parser.c */
string_part *parse_single_string(parser *p, size_t *out_len);
string_part *parse_backtick_string(parser *p, size_t *out_len);
node        *parse_unquoted(parser *p);
deon_str     literal_of(parser *p, string_part *parts, size_t len);

/* parser.c helpers used by strings.c for decoding: a sub-parser over an extracted string, and one
 * interpolation parsed on the current cursor (both reach the reference parser, which lives in parser.c). */
parser      *sub_parser(deon_ctx *ctx, const char *utf8, size_t len);
string_part  parse_interpolation_part(parser *p);

#endif
