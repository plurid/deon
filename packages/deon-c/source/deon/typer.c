#include "internal.h"

#include <stdlib.h>
#include <math.h>

/* The conservative typer (section 14). Typing is outside the Deon data model, so this is a view of a
 * value rather than a value: it converts only what it could write back out unchanged, and refuses
 * whenever a guess could be wrong. 007 stays a string, because a postal code that becomes 7 is a bug;
 * null stays "null", because Deon has no null; a number too large for a float stays a string, because a
 * float would hand back a different number than the one written. */

#define SAFE_INTEGER 9007199254740991.0 /* 2^53 - 1 */

static bool match_integer(const char *s, size_t len) {
    size_t i = 0;
    if (i < len && s[i] == '-') i++;
    if (i >= len) return false;
    if (s[i] == '0') { i++; return i == len; }
    if (s[i] < '1' || s[i] > '9') return false;
    while (i < len && s[i] >= '0' && s[i] <= '9') i++;
    return i == len;
}

static bool match_number(const char *s, size_t len) {
    size_t i = 0;
    if (i < len && s[i] == '-') i++;
    if (i >= len) return false;
    /* integer part: 0 | [1-9][0-9]* */
    if (s[i] == '0') { i++; }
    else if (s[i] >= '1' && s[i] <= '9') { i++; while (i < len && s[i] >= '0' && s[i] <= '9') i++; }
    else return false;
    /* fraction */
    if (i < len && s[i] == '.') {
        i++;
        if (i >= len || s[i] < '0' || s[i] > '9') return false;
        while (i < len && s[i] >= '0' && s[i] <= '9') i++;
    }
    /* exponent */
    if (i < len && (s[i] == 'e' || s[i] == 'E')) {
        i++;
        if (i < len && (s[i] == '+' || s[i] == '-')) i++;
        if (i >= len || s[i] < '0' || s[i] > '9') return false;
        while (i < len && s[i] >= '0' && s[i] <= '9') i++;
    }
    return i == len;
}

static deon_value *type_scalar(arena *a, deon_str s) {
    if (str_eq(s, "true")) return value_bool(a, true);
    if (str_eq(s, "false")) return value_bool(a, false);

    if (match_integer(s.data, s.len)) {
        double n = strtod(s.data, NULL);
        if (n >= -SAFE_INTEGER && n <= SAFE_INTEGER) return value_number(a, n);
        return value_string(a, s);
    }
    if (match_number(s.data, s.len)) {
        double n = strtod(s.data, NULL);
        if (isfinite(n)) return value_number(a, n);
        return value_string(a, s);
    }
    return value_string(a, s);
}

deon_value *type_value(arena *a, const deon_value *value) {
    switch (value->kind) {
        case DEON_STRING:
            return type_scalar(a, value->as.string);
        case DEON_LIST: {
            deon_value *out = value_empty_list(a);
            for (size_t i = 0; i < value->as.list.len; i++) list_push(a, out, type_value(a, value->as.list.items[i]));
            return out;
        }
        case DEON_MAP: {
            deon_value *out = value_empty_map(a);
            for (size_t i = 0; i < value->as.map.len; i++) map_set(a, out, value->as.map.keys[i], type_value(a, value->as.map.values[i]));
            return out;
        }
        default:
            return (deon_value *)value;
    }
}
