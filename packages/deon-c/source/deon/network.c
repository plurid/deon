#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "internal.h"

#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netdb.h>

/* Reading a resource over HTTP once the network has been granted (section 9). This is plain HTTP over a
 * socket, with no third-party client and no TLS — an https target it cannot reach is a DEON_RESOURCE_IO,
 * the same as any other unreachable one. The request is HTTP/1.0 with Connection: close, so the body is
 * everything the server sends before it closes, with no chunked framing to unwrap. A non-2xx status is
 * DEON_RESOURCE_IO: it was allowed and it failed, which is not the same as never having been allowed. */

static void net_fail(deon_ctx *ctx, const char *what, const char *target, deon_span span) {
    char msg[1024];
    snprintf(msg, sizeof(msg), "%s '%s'.", what, target);
    deon_fail(ctx, DEON_RESOURCE_IO, msg, span);
}

/* read the whole of a file descriptor to EOF into a growing buffer */
static char *read_all(int fd, size_t *out_len) {
    size_t cap = 8192, len = 0;
    char *buf = malloc(cap);
    for (;;) {
        if (len == cap) { cap *= 2; buf = realloc(buf, cap); }
        ssize_t n = read(fd, buf + len, cap - len);
        if (n < 0) { free(buf); return NULL; }
        if (n == 0) break;
        len += (size_t)n;
    }
    *out_len = len;
    return buf;
}

deon_str http_get(deon_ctx *ctx, const char *target, const char *kind, const char *token, deon_span span) {
    const char *rest;
    if (strncmp(target, "http://", 7) == 0) rest = target + 7;
    else { net_fail(ctx, "Unable to reach resource", target, span); rest = NULL; }

    /* host[:port]/path */
    const char *p = rest;
    while (*p && *p != '/' && *p != ':') p++;
    char host[256];
    size_t hl = (size_t)(p - rest);
    if (hl >= sizeof(host)) hl = sizeof(host) - 1;
    memcpy(host, rest, hl);
    host[hl] = '\0';

    char port[16] = "80";
    if (*p == ':') {
        p++;
        size_t k = 0;
        while (*p && *p != '/' && k + 1 < sizeof(port)) port[k++] = *p++;
        port[k] = '\0';
        while (*p && *p != '/') p++;
    }
    const char *path = (*p == '/') ? p : "/";

    const char *accept;
    if (strcmp(kind, "import") == 0) accept = "text/plain,application/json,application/deon";
    else if (strcmp(kind, "link") == 0) accept = "application/deon";
    else accept = "*/*";

    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host, port, &hints, &res) != 0 || !res) {
        net_fail(ctx, "Unable to reach resource", target, span);
    }

    int fd = -1;
    for (struct addrinfo *ai = res; ai; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) break;
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0) net_fail(ctx, "Unable to reach resource", target, span);

    sb req = {0};
    sb_puts(&req, "GET ");
    sb_puts(&req, path);
    sb_puts(&req, " HTTP/1.0\r\nHost: ");
    sb_puts(&req, host);
    sb_puts(&req, "\r\nAccept: ");
    sb_puts(&req, accept);
    sb_puts(&req, "\r\n");
    if (token && token[0]) {
        sb_puts(&req, "Authorization: Bearer ");
        sb_puts(&req, token);
        sb_puts(&req, "\r\n");
    }
    sb_puts(&req, "Connection: close\r\n\r\n");

    size_t sent = 0;
    while (sent < req.len) {
        ssize_t n = write(fd, req.data + sent, req.len - sent);
        if (n <= 0) { sb_free(&req); close(fd); net_fail(ctx, "Unable to reach resource", target, span); }
        sent += (size_t)n;
    }
    sb_free(&req);

    size_t total;
    char *raw = read_all(fd, &total);
    close(fd);
    if (!raw) net_fail(ctx, "Unable to read resource", target, span);

    /* status line: "HTTP/1.x CODE ..." */
    int status = 0;
    {
        char *sp = memchr(raw, ' ', total);
        if (sp) status = atoi(sp + 1);
    }

    /* body starts after the header terminator */
    char *sep = NULL;
    for (size_t i = 0; i + 3 < total; i++) {
        if (raw[i] == '\r' && raw[i + 1] == '\n' && raw[i + 2] == '\r' && raw[i + 3] == '\n') { sep = raw + i + 4; break; }
    }
    char *body = sep ? sep : raw;
    size_t body_len = sep ? total - (size_t)(sep - raw) : total;

    if (status < 200 || status >= 300) {
        free(raw);
        net_fail(ctx, "Resource returned a non-success status:", target, span);
    }
    if (!utf8_valid(body, body_len)) {
        free(raw);
        char msg[1024];
        snprintf(msg, sizeof(msg), "The resource '%s' is not valid UTF-8.", target);
        deon_fail(ctx, DEON_RESOURCE_FORMAT, msg, span);
    }

    deon_str out = arena_str(ctx->a, body, body_len);
    free(raw);
    return out;
}
