#include "internal.h"

#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* The arena is a singly-linked list of blocks. Allocation bumps a pointer inside the current block and
 * chains a fresh one when it runs out; a request larger than a block gets its own. Nothing is freed
 * until the whole arena is, which is the point. */

#define ARENA_BLOCK (64 * 1024)

struct arena_block;
typedef struct arena_block {
    struct arena_block *next;
    size_t              cap;
    size_t              used;
    char                data[];
} arena_block;

struct arena {
    arena_block *head;
};

static void *xmalloc(size_t n) {
    void *p = malloc(n);
    if (!p) {
        fprintf(stderr, "deon: out of memory\n");
        abort();
    }
    return p;
}

arena *arena_new(void) {
    arena *a = xmalloc(sizeof(*a));
    a->head = NULL;
    return a;
}

void arena_free(arena *a) {
    if (!a) return;
    arena_block *b = a->head;
    while (b) {
        arena_block *next = b->next;
        free(b);
        b = next;
    }
    free(a);
}

void *arena_alloc(arena *a, size_t size) {
    size = (size + 15u) & ~(size_t)15u; /* 16-byte alignment */
    if (!a->head || a->head->used + size > a->head->cap) {
        size_t cap = size > ARENA_BLOCK ? size : ARENA_BLOCK;
        arena_block *b = xmalloc(sizeof(*b) + cap);
        b->next = a->head;
        b->cap = cap;
        b->used = 0;
        a->head = b;
    }
    void *p = a->head->data + a->head->used;
    a->head->used += size;
    memset(p, 0, size);
    return p;
}

char *arena_memdup(arena *a, const char *data, size_t len) {
    char *p = arena_alloc(a, len + 1);
    if (len) memcpy(p, data, len);
    p[len] = '\0';
    return p;
}

deon_str arena_str(arena *a, const char *data, size_t len) {
    deon_str s;
    s.data = arena_memdup(a, data, len);
    s.len = len;
    return s;
}

deon_str arena_str_cstr(arena *a, const char *cstr) {
    return arena_str(a, cstr, strlen(cstr));
}

/* #region string builder */
void sb_reserve(sb *b, size_t extra) {
    if (b->len + extra + 1 > b->cap) {
        size_t cap = b->cap ? b->cap : 64;
        while (b->len + extra + 1 > cap) cap *= 2;
        b->data = realloc(b->data, cap);
        if (!b->data) {
            fprintf(stderr, "deon: out of memory\n");
            abort();
        }
        b->cap = cap;
    }
}

void sb_putc(sb *b, char c) {
    sb_reserve(b, 1);
    b->data[b->len++] = c;
}

void sb_put(sb *b, const char *data, size_t len) {
    if (!len) return;
    sb_reserve(b, len);
    memcpy(b->data + b->len, data, len);
    b->len += len;
}

void sb_puts(sb *b, const char *cstr) {
    sb_put(b, cstr, strlen(cstr));
}

void sb_put_rune(sb *b, uint32_t rune) {
    utf8_encode(rune, b);
}

char *sb_finish(sb *b, size_t *out_len) {
    if (!b->data) {
        b->data = xmalloc(1);
        b->cap = 1;
    }
    b->data[b->len] = '\0';
    if (out_len) *out_len = b->len;
    char *data = b->data;
    b->data = NULL;
    b->len = b->cap = 0;
    return data;
}

void sb_free(sb *b) {
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
}

deon_str sb_into_arena(sb *b, arena *a) {
    deon_str s = arena_str(a, b->data ? b->data : "", b->len);
    sb_free(b);
    return s;
}
/* #endregion */
