#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/types.h>

/* The response cache. Two requirements of section 9 are the reason this is not a map keyed by URL:
 * tokens must not appear in cache identifiers in plain text, and authenticated entries must be separated
 * by a digest of the credential. So an entry is keyed by sha256(name + NUL + token). The digest keeps
 * the credential out of the filename, and folding the token into the key is what stops a document
 * fetched under one credential from being served to the holder of another — a data leak, not a miss.
 *
 * An entry is itself a canonical Deon document, a small piece of dogfooding: the format has to survive a
 * round trip, so it is made to, on every write and every read. Every failure here is silent, because a
 * cache that raised would turn a performance decision into a correctness one. */

#define DEFAULT_CACHE_DURATION 3600000 /* one hour, milliseconds */

/* #region SHA-256 */
typedef struct { uint32_t s[8]; uint64_t len; unsigned char buf[64]; size_t n; } sha256;

static uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static void sha256_block(sha256 *h, const unsigned char *p) {
    static const uint32_t K[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2 };
    uint32_t w[64];
    for (int i = 0; i < 16; i++)
        w[i] = (uint32_t)p[i*4] << 24 | (uint32_t)p[i*4+1] << 16 | (uint32_t)p[i*4+2] << 8 | (uint32_t)p[i*4+3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >> 3);
        uint32_t s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    uint32_t a=h->s[0],b=h->s[1],c=h->s[2],d=h->s[3],e=h->s[4],f=h->s[5],g=h->s[6],hh=h->s[7];
    for (int i = 0; i < 64; i++) {
        uint32_t S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        uint32_t ch = (e & f) ^ (~e & g);
        uint32_t t1 = hh + S1 + ch + K[i] + w[i];
        uint32_t S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t t2 = S0 + maj;
        hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    h->s[0]+=a; h->s[1]+=b; h->s[2]+=c; h->s[3]+=d; h->s[4]+=e; h->s[5]+=f; h->s[6]+=g; h->s[7]+=hh;
}

static void sha256_init(sha256 *h) {
    h->s[0]=0x6a09e667; h->s[1]=0xbb67ae85; h->s[2]=0x3c6ef372; h->s[3]=0xa54ff53a;
    h->s[4]=0x510e527f; h->s[5]=0x9b05688c; h->s[6]=0x1f83d9ab; h->s[7]=0x5be0cd19;
    h->len = 0; h->n = 0;
}

static void sha256_update(sha256 *h, const void *data, size_t len) {
    const unsigned char *p = data;
    h->len += len;
    while (len) {
        size_t take = 64 - h->n;
        if (take > len) take = len;
        memcpy(h->buf + h->n, p, take);
        h->n += take; p += take; len -= take;
        if (h->n == 64) { sha256_block(h, h->buf); h->n = 0; }
    }
}

static void sha256_hex(sha256 *h, char out[65]) {
    uint64_t bits = h->len * 8;
    unsigned char pad = 0x80;
    sha256_update(h, &pad, 1);
    unsigned char zero = 0;
    while (h->n != 56) sha256_update(h, &zero, 1);
    unsigned char lenbe[8];
    for (int i = 0; i < 8; i++) lenbe[i] = (unsigned char)(bits >> (56 - i*8));
    sha256_update(h, lenbe, 8);
    static const char hexd[] = "0123456789abcdef";
    for (int i = 0; i < 8; i++) {
        for (int j = 0; j < 4; j++) {
            unsigned char byte = (unsigned char)(h->s[i] >> (24 - j*8));
            out[(i*4+j)*2] = hexd[byte >> 4];
            out[(i*4+j)*2+1] = hexd[byte & 0xf];
        }
    }
    out[64] = '\0';
}

static void cache_key(const char *name, const char *token, char out[65]) {
    sha256 h;
    sha256_init(&h);
    sha256_update(&h, name, strlen(name));
    unsigned char nul = 0;
    sha256_update(&h, &nul, 1);
    sha256_update(&h, token, strlen(token));
    sha256_hex(&h, out);
}
/* #endregion */

static long long now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static int cache_duration_of(const deon_options *o) {
    return o->cache_duration > 0 ? o->cache_duration : DEFAULT_CACHE_DURATION;
}

/* expand a leading ~ to $HOME, leaving everything else alone */
static void expand_user(const char *path, char *out, size_t cap) {
    if (path[0] == '~' && (path[1] == '\0' || path[1] == '/')) {
        const char *home = getenv("HOME");
        if (home) { snprintf(out, cap, "%s%s", home, path + 1); return; }
    }
    snprintf(out, cap, "%s", path);
}

static bool entry_path(const deon_options *o, const char *name, const char *token, char *out, size_t cap) {
    if (!o->cache) return false;
    const char *dir = o->cache_directory ? o->cache_directory : "~/.deon-cache";
    char expanded[2048];
    expand_user(dir, expanded, sizeof(expanded));
    char key[65];
    cache_key(name, token, key);
    snprintf(out, cap, "%s/%s", expanded, key);
    return true;
}

static void mkdir_p(const char *path) {
    char tmp[2048];
    snprintf(tmp, sizeof(tmp), "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') { *p = '\0'; mkdir(tmp, 0755); *p = '/'; }
    }
    mkdir(tmp, 0755);
}

static char *read_file_all(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return NULL; }
    rewind(f);
    char *buf = malloc((size_t)sz + 1);
    size_t got = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[got] = '\0';
    *out_len = got;
    return buf;
}

static bool cache_int(deon_value *m, const char *key, long long *out) {
    deon_value *v = deon_map_get(m, key);
    if (!v || v->kind != DEON_STRING) return false;
    char tmp[64];
    if (v->as.string.len >= sizeof(tmp)) return false;
    memcpy(tmp, v->as.string.data, v->as.string.len);
    tmp[v->as.string.len] = '\0';
    char *stop = NULL;
    long long n = strtoll(tmp, &stop, 10);
    if (stop == tmp || (stop && *stop != '\0')) return false;
    *out = n;
    return true;
}

bool cache_read(const deon_options *options, const char *name, const char *token, arena *a, deon_str *out) {
    char path[2200];
    if (!entry_path(options, name, token, path, sizeof(path))) return false;

    size_t len;
    char *source = read_file_all(path, &len);
    if (!source) return false;

    deon_document *doc = deon_parse(source, len);
    free(source);
    if (!deon_document_ok(doc)) { deon_document_free(doc); return false; }

    deon_value *root = deon_document_root(doc);
    if (!root || root->kind != DEON_MAP) { deon_document_free(doc); return false; }

    long long cached_at, duration;
    if (!cache_int(root, "cachedAt", &cached_at) || !cache_int(root, "cacheDuration", &duration)) {
        deon_document_free(doc);
        return false;
    }
    if (cached_at + duration < now_ms()) {
        deon_document_free(doc);
        remove(path);
        return false;
    }
    deon_value *data = deon_map_get(root, "data");
    if (!data || data->kind != DEON_STRING) { deon_document_free(doc); return false; }

    *out = arena_str(a, data->as.string.data, data->as.string.len);
    deon_document_free(doc);
    return true;
}

void cache_write(const deon_options *options, const char *name, const char *token, deon_str body) {
    char path[2200];
    if (!entry_path(options, name, token, path, sizeof(path))) return;

    arena *a = arena_new();
    deon_value *entry = value_empty_map(a);
    char ca[32], cd[32];
    snprintf(ca, sizeof(ca), "%lld", now_ms());
    snprintf(cd, sizeof(cd), "%d", cache_duration_of(options));
    map_set(a, entry, arena_str_cstr(a, "cachedAt"), value_string_cstr(a, ca));
    map_set(a, entry, arena_str_cstr(a, "cacheDuration"), value_string_cstr(a, cd));
    map_set(a, entry, arena_str_cstr(a, "data"), value_string(a, arena_str(a, body.data, body.len)));

    size_t clen;
    char *text = deon_canonical(entry, &clen, NULL); /* a cache entry is a shallow, hand-built map */

    /* strip the final directory component to make the parent path */
    char dir[2200];
    snprintf(dir, sizeof(dir), "%s", path);
    char *slash = strrchr(dir, '/');
    if (slash) { *slash = '\0'; mkdir_p(dir); }

    FILE *f = fopen(path, "wb");
    if (f) { fwrite(text, 1, clen, f); fclose(f); }
    free(text);
    arena_free(a);
}
