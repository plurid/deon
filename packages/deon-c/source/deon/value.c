#include "internal.h"

#include <string.h>

/* Value construction and the ordered map. A rewritten key does not stay in its original slot: it is
 * removed and re-appended, so it moves to its final write position (section 5). Equality compares maps
 * by lookup — order is presentation, not identity — and lists positionally. */

deon_value *value_string(arena *a, deon_str s) {
    deon_value *v = arena_alloc(a, sizeof(*v));
    v->kind = DEON_STRING;
    v->as.string = s;
    return v;
}

deon_value *value_string_cstr(arena *a, const char *s) {
    return value_string(a, arena_str_cstr(a, s));
}

deon_value *value_bool(arena *a, bool b) {
    deon_value *v = arena_alloc(a, sizeof(*v));
    v->kind = DEON_BOOL;
    v->as.boolean = b;
    return v;
}

deon_value *value_number(arena *a, double n) {
    deon_value *v = arena_alloc(a, sizeof(*v));
    v->kind = DEON_NUMBER;
    v->as.number = n;
    return v;
}

deon_value *value_empty_map(arena *a) {
    deon_value *v = arena_alloc(a, sizeof(*v));
    v->kind = DEON_MAP;
    return v;
}

deon_value *value_empty_list(arena *a) {
    deon_value *v = arena_alloc(a, sizeof(*v));
    v->kind = DEON_LIST;
    return v;
}

static void map_reserve(arena *a, deon_value *m, size_t want) {
    if (want <= m->as.map.cap) return;
    size_t cap = m->as.map.cap ? m->as.map.cap * 2 : 8;
    while (cap < want) cap *= 2;
    deon_str *keys = arena_alloc(a, cap * sizeof(*keys));
    deon_value **vals = arena_alloc(a, cap * sizeof(*vals));
    if (m->as.map.len) {
        memcpy(keys, m->as.map.keys, m->as.map.len * sizeof(*keys));
        memcpy(vals, m->as.map.values, m->as.map.len * sizeof(*vals));
    }
    m->as.map.keys = keys;
    m->as.map.values = vals;
    m->as.map.cap = cap;
}

void map_set(arena *a, deon_value *m, deon_str key, deon_value *value) {
    for (size_t i = 0; i < m->as.map.len; i++) {
        if (str_eq_str(m->as.map.keys[i], key)) {
            /* Remove the old slot, so the rewrite moves the key to the end (section 5). */
            for (size_t j = i; j + 1 < m->as.map.len; j++) {
                m->as.map.keys[j] = m->as.map.keys[j + 1];
                m->as.map.values[j] = m->as.map.values[j + 1];
            }
            m->as.map.len--;
            break;
        }
    }
    map_reserve(a, m, m->as.map.len + 1);
    m->as.map.keys[m->as.map.len] = key;
    m->as.map.values[m->as.map.len] = value;
    m->as.map.len++;
}

bool map_get(const deon_value *m, deon_str key, deon_value **out) {
    for (size_t i = 0; i < m->as.map.len; i++) {
        if (str_eq_str(m->as.map.keys[i], key)) {
            if (out) *out = m->as.map.values[i];
            return true;
        }
    }
    return false;
}

void list_push(arena *a, deon_value *l, deon_value *value) {
    if (l->as.list.len == l->as.list.cap) {
        size_t cap = l->as.list.cap ? l->as.list.cap * 2 : 8;
        deon_value **items = arena_alloc(a, cap * sizeof(*items));
        if (l->as.list.len) memcpy(items, l->as.list.items, l->as.list.len * sizeof(*items));
        l->as.list.items = items;
        l->as.list.cap = cap;
    }
    l->as.list.items[l->as.list.len++] = value;
}

bool deon_value_equal(const deon_value *a, const deon_value *b) {
    if (a->kind != b->kind) return false;
    switch (a->kind) {
        case DEON_STRING:
        case DEON_NUMBER: /* NUMBER carries its spelling in .string when built by json; compare text */
            if (a->kind == DEON_NUMBER) return a->as.number == b->as.number;
            return str_eq_str(a->as.string, b->as.string);
        case DEON_BOOL:
            return a->as.boolean == b->as.boolean;
        case DEON_LIST:
            if (a->as.list.len != b->as.list.len) return false;
            for (size_t i = 0; i < a->as.list.len; i++) {
                if (!deon_value_equal(a->as.list.items[i], b->as.list.items[i])) return false;
            }
            return true;
        case DEON_MAP:
            if (a->as.map.len != b->as.map.len) return false;
            for (size_t i = 0; i < a->as.map.len; i++) {
                deon_value *other;
                if (!map_get(b, a->as.map.keys[i], &other)) return false;
                if (!deon_value_equal(a->as.map.values[i], other)) return false;
            }
            return true;
    }
    return false;
}

deon_value *deon_map_get(const deon_value *map, const char *key) {
    if (!map || map->kind != DEON_MAP) return NULL;
    for (size_t i = 0; i < map->as.map.len; i++) {
        if (str_eq(map->as.map.keys[i], key)) return map->as.map.values[i];
    }
    return NULL;
}
