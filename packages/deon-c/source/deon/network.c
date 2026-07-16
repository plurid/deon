#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "internal.h"

#include <string.h>
#include <strings.h> /* strcasecmp, strncasecmp */
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <netdb.h>

#ifdef DEON_NETWORK
/* LibreSSL's libtls. Compiled in and linked (-ltls) only when the network build flag is set; the default
 * build never mentions it and stays dependency-free. See the Makefile's `network-build` target. */
#include <tls.h>
#endif

/* Reading a resource over HTTP once the network has been granted (section 9).
 *
 * Two transports share one request/response/redirect path:
 *   - http://  is plain HTTP over a POSIX socket, with no third-party client and no TLS. This is the
 *     zero-dependency default and is always compiled.
 *   - https:// speaks real TLS via libtls, but ONLY under -DDEON_NETWORK. Certificate verification is
 *     libtls's default and is never disabled here. When the flag is absent, an https target is refused
 *     up front with DEON_CAPABILITY_DENIED — the same class of diagnostic the network-denied path
 *     returns — rather than a crash or a silent plaintext downgrade.
 *
 * The request is HTTP/1.0 with Connection: close, so the body is everything the server sends before it
 * closes, with no chunked framing to unwrap. A non-2xx status is DEON_RESOURCE_IO: it was allowed and it
 * failed, which is not the same as never having been allowed.
 *
 * Hardening (all on both transports):
 *   - The target and the authenticator are validated before any request is built: a CR, LF, NUL, or any
 *     other control byte is refused, so neither can smuggle a header or split the request.
 *   - The response (headers + body) is capped; a server that never stops sending cannot exhaust memory.
 *   - connect(2), and every read and write, are bounded by a deadline.
 *   - Redirects are followed up to a small maximum; exceeding it is a resource error. A redirect that
 *     changes origin (scheme/host/port) drops the Authorization credential, so it never leaks to a host
 *     the caller did not authenticate to.
 */

#define NET_TIMEOUT_MS 30000    /* connect, read, and write deadline; matches the other clients */
#define NET_MAX_REDIRECTS 5     /* at most five redirects are followed before it is a resource error */
#define NET_URL_MAX 2048        /* the longest target/redirect URL handled */

/* The whole of one response — headers and body together — is bounded so an unbounded (or hostile) server
 * cannot make the parse allocate without limit. Sixteen mebibytes is far past any real configuration
 * document and well short of a memory problem. Overridable at build time for tests. */
#ifndef DEON_NET_MAX_RESPONSE
#define DEON_NET_MAX_RESPONSE (16u * 1024u * 1024u)
#endif

static void net_fail(deon_ctx *ctx, const char *what, const char *target, deon_span span) {
    char msg[1024];
    snprintf(msg, sizeof(msg), "%s '%s'.", what, target);
    deon_fail(ctx, DEON_RESOURCE_IO, msg, span);
}

/* #region input validation
 * A target or credential may carry no control byte. CR and LF are the header-injection / request-smuggling
 * vectors; NUL, DEL, and the other C0 bytes have no business in a URL or a bearer token either. The
 * length-aware form catches an embedded NUL; the C-string form is the common case (a C string cannot hold
 * an interior NUL, so upstream truncation is the only way one arrives, and the byte form guards the rest). */
bool deon_net_bytes_ok(const char *s, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c < 0x20 || c == 0x7f) return false;
    }
    return true;
}
bool deon_net_input_ok(const char *s) {
    return s ? deon_net_bytes_ok(s, strlen(s)) : true;
}
/* #endregion */

/* #region URL parsing and origin */
typedef struct {
    char scheme[8];   /* "http" or "https" */
    char host[256];
    char port[16];    /* numeric; defaulted from the scheme when absent */
    char path[NET_URL_MAX]; /* begins with '/'; carries any query/fragment verbatim */
} url_t;

/* parse an absolute http(s) URL. Returns 0 on success, -1 on an unsupported scheme or a malformed one
 * (empty host, non-numeric port, over-long component). */
static int parse_url(const char *u, url_t *out) {
    memset(out, 0, sizeof(*out));
    const char *rest;
    int https = 0;
    if (strncmp(u, "http://", 7) == 0) { rest = u + 7; snprintf(out->scheme, sizeof out->scheme, "http"); }
    else if (strncmp(u, "https://", 8) == 0) { rest = u + 8; https = 1; snprintf(out->scheme, sizeof out->scheme, "https"); }
    else return -1;

    const char *p = rest;
    while (*p && *p != '/' && *p != ':') p++;
    size_t hl = (size_t)(p - rest);
    if (hl == 0 || hl >= sizeof(out->host)) return -1;
    memcpy(out->host, rest, hl);
    out->host[hl] = '\0';

    if (*p == ':') {
        p++;
        size_t k = 0;
        while (*p && *p != '/') {
            if (*p < '0' || *p > '9') return -1;      /* a port is digits only */
            if (k + 1 >= sizeof(out->port)) return -1;
            out->port[k++] = *p++;
        }
        out->port[k] = '\0';
        if (k == 0) return -1;                          /* "host:" with no port */
    } else {
        snprintf(out->port, sizeof out->port, "%s", https ? "443" : "80");
    }

    if (*p == '/') {
        size_t k = 0;
        while (*p) {
            if (k + 1 >= sizeof(out->path)) return -1;
            out->path[k++] = *p++;
        }
        out->path[k] = '\0';
    } else {
        snprintf(out->path, sizeof out->path, "/");
    }
    return 0;
}

static int default_port(const url_t *u) {
    return (strcmp(u->scheme, "http") == 0 && strcmp(u->port, "80") == 0)
        || (strcmp(u->scheme, "https") == 0 && strcmp(u->port, "443") == 0);
}

/* Two URLs share an origin when scheme, host (case-insensitive), and effective port all match. Ports are
 * normalized to their scheme default at parse time, so an explicit :80 and an implicit one agree. */
static int same_origin(const url_t *a, const url_t *b) {
    return strcmp(a->scheme, b->scheme) == 0
        && strcasecmp(a->host, b->host) == 0
        && strcmp(a->port, b->port) == 0;
}

/* Resolve a Location value against the base URL: an absolute URL is taken as is; "//host/..." inherits the
 * scheme; "/path" keeps the origin; anything else is resolved against the base's directory. Returns 0 on
 * success, -1 if the result will not fit. */
static int resolve_url(const url_t *base, const char *loc, char *out, size_t outcap) {
    if (strncmp(loc, "http://", 7) == 0 || strncmp(loc, "https://", 8) == 0) {
        return snprintf(out, outcap, "%s", loc) < (int)outcap ? 0 : -1;
    }

    char authority[300];
    if (default_port(base)) snprintf(authority, sizeof authority, "%s://%s", base->scheme, base->host);
    else                    snprintf(authority, sizeof authority, "%s://%s:%s", base->scheme, base->host, base->port);

    if (loc[0] == '/' && loc[1] == '/') /* scheme-relative */
        return snprintf(out, outcap, "%s:%s", base->scheme, loc) < (int)outcap ? 0 : -1;
    if (loc[0] == '/') /* absolute-path */
        return snprintf(out, outcap, "%s%s", authority, loc) < (int)outcap ? 0 : -1;

    /* relative to the base's directory */
    char dir[NET_URL_MAX];
    snprintf(dir, sizeof dir, "%s", base->path);
    char *slash = strrchr(dir, '/');
    if (slash) slash[1] = '\0'; else snprintf(dir, sizeof dir, "/");
    return snprintf(out, outcap, "%s%s%s", authority, dir, loc) < (int)outcap ? 0 : -1;
}

/* Copy the value of a header out of the header block [raw, raw+header_len) (which begins with the status
 * line). Case-insensitive on the name. Returns 1 and fills out when found, 0 otherwise. */
static int header_value(const char *raw, size_t header_len, const char *name, char *out, size_t outcap) {
    size_t namelen = strlen(name);
    const char *end = raw + header_len;
    const char *p = raw;
    while (p < end && *p != '\n') p++;      /* skip the status line */
    if (p < end) p++;
    while (p < end) {
        const char *line = p;
        const char *le = line;
        while (le < end && *le != '\r' && *le != '\n') le++;
        if ((size_t)(le - line) > namelen && strncasecmp(line, name, namelen) == 0 && line[namelen] == ':') {
            const char *v = line + namelen + 1;
            while (v < le && (*v == ' ' || *v == '\t')) v++;
            size_t vl = (size_t)(le - v);
            if (vl >= outcap) vl = outcap - 1;
            memcpy(out, v, vl);
            out[vl] = '\0';
            return 1;
        }
        p = le;
        while (p < end && (*p == '\r' || *p == '\n')) p++;
        if (p == line) break; /* no progress guard */
    }
    return 0;
}
/* #endregion */

/* #region transport
 * A connection is a socket, and for https a TLS session over it. read/write/close are uniform across both,
 * so the request/response/redirect logic is written once. */
typedef struct {
    int fd;
#ifdef DEON_NETWORK
    struct tls *tls; /* NULL for plaintext http */
#endif
} conn;

#ifdef DEON_NETWORK
/* wait until fd is ready (or the deadline passes). Used to bound libtls's want-poll retries. */
static int poll_ready(int fd, short events, int timeout_ms) {
    struct pollfd pfd = {.fd = fd, .events = events};
    int rc;
    do { rc = poll(&pfd, 1, timeout_ms); } while (rc < 0 && errno == EINTR);
    return rc > 0;
}
#endif

static ssize_t conn_read(conn *c, void *buf, size_t n) {
#ifdef DEON_NETWORK
    if (c->tls) {
        for (;;) {
            ssize_t r = tls_read(c->tls, buf, n);
            if (r == TLS_WANT_POLLIN || r == TLS_WANT_POLLOUT) {
                if (!poll_ready(c->fd, r == TLS_WANT_POLLIN ? POLLIN : POLLOUT, NET_TIMEOUT_MS)) return -1;
                continue;
            }
            return r;
        }
    }
#endif
    return read(c->fd, buf, n);
}

static ssize_t conn_write(conn *c, const void *buf, size_t n) {
#ifdef DEON_NETWORK
    if (c->tls) {
        for (;;) {
            ssize_t r = tls_write(c->tls, buf, n);
            if (r == TLS_WANT_POLLIN || r == TLS_WANT_POLLOUT) {
                if (!poll_ready(c->fd, r == TLS_WANT_POLLIN ? POLLIN : POLLOUT, NET_TIMEOUT_MS)) return -1;
                continue;
            }
            return r;
        }
    }
#endif
    return write(c->fd, buf, n);
}

static void conn_close(conn *c) {
#ifdef DEON_NETWORK
    if (c->tls) { tls_close(c->tls); tls_free(c->tls); c->tls = NULL; }
#endif
    if (c->fd >= 0) { close(c->fd); c->fd = -1; }
}

/* connect(2) with a deadline: connect on a non-blocking socket, wait for it to become writable within the
 * timeout, then restore blocking mode. Returns 0 on success, -1 on failure or timeout. */
static int connect_timeout(int fd, const struct sockaddr *addr, socklen_t len, int timeout_ms) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return -1;

    int rc = connect(fd, addr, len);
    if (rc != 0) {
        if (errno != EINPROGRESS) return -1;
        struct pollfd pfd = {.fd = fd, .events = POLLOUT};
        do { rc = poll(&pfd, 1, timeout_ms); } while (rc < 0 && errno == EINTR);
        if (rc <= 0) return -1; /* -1 error, 0 timeout */
        int err = 0;
        socklen_t elen = sizeof(err);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &elen) < 0 || err != 0) return -1;
    }

    if (fcntl(fd, F_SETFL, flags) < 0) return -1;
    return 0;
}

/* open a bounded connection to the URL's host: DNS, a deadline'd connect, socket timeouts, and — for
 * https under -DDEON_NETWORK — a verified TLS handshake. Fails (longjmp) on any error. */
static void open_conn(deon_ctx *ctx, const url_t *u, const char *target, deon_span span, conn *c) {
    c->fd = -1;
#ifdef DEON_NETWORK
    c->tls = NULL;
#endif

    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(u->host, u->port, &hints, &res) != 0 || !res)
        net_fail(ctx, "Unable to reach resource", target, span);

    int fd = -1;
    for (struct addrinfo *ai = res; ai; ai = ai->ai_next) {
        fd = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        if (connect_timeout(fd, ai->ai_addr, ai->ai_addrlen, NET_TIMEOUT_MS) == 0) break;
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    if (fd < 0) net_fail(ctx, "Unable to reach resource", target, span);

    /* The read and write are bounded too, so a server that connects and then stalls cannot hang the
     * fetch: an operation past the deadline returns an error, read as an unreadable resource. */
    struct timeval tv = {.tv_sec = NET_TIMEOUT_MS / 1000, .tv_usec = (NET_TIMEOUT_MS % 1000) * 1000};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    c->fd = fd;

    if (strcmp(u->scheme, "https") == 0) {
#ifdef DEON_NETWORK
        struct tls_config *cfg = tls_config_new();
        struct tls *t = tls_client();
        /* Verification is libtls's default and is deliberately left on — we never call
         * tls_config_insecure_noverifycert() or _noverifyname(). A bad certificate fails the fetch. */
        if (!cfg || !t || tls_configure(t, cfg) != 0) {
            if (t) tls_free(t);
            if (cfg) tls_config_free(cfg);
            conn_close(c);
            net_fail(ctx, "Unable to establish a secure connection to", target, span);
        }
        tls_config_free(cfg); /* tls_configure took its own reference */

        /* Connect over the socket already bounded above; the host is the SNI name and the name verified
         * against the certificate. */
        if (tls_connect_socket(t, fd, u->host) != 0) {
            tls_free(t);
            conn_close(c);
            net_fail(ctx, "Unable to establish a secure connection to", target, span);
        }
        for (;;) {
            int hr = tls_handshake(t);
            if (hr == 0) break;
            if (hr == TLS_WANT_POLLIN || hr == TLS_WANT_POLLOUT) {
                if (!poll_ready(fd, hr == TLS_WANT_POLLIN ? POLLIN : POLLOUT, NET_TIMEOUT_MS)) {
                    tls_free(t);
                    conn_close(c);
                    net_fail(ctx, "Timed out establishing a secure connection to", target, span);
                }
                continue;
            }
            tls_free(t);
            conn_close(c);
            net_fail(ctx, "Unable to establish a secure connection to", target, span);
        }
        c->tls = t;
#else
        /* Unreachable: http_get refuses https before opening a socket when TLS is not built in. */
        conn_close(c);
        net_fail(ctx, "Unable to reach resource", target, span);
#endif
    }
}
/* #endregion */

/* read a connection to EOF into a growing buffer, but never past max bytes. Sets *overflow when the server
 * had more to give than the cap allowed. NUL-terminates so the header scan is safe. Returns NULL on a read
 * error or allocation failure. */
static char *read_all_capped(conn *c, size_t max, size_t *out_len, int *overflow) {
    size_t cap = 8192, len = 0;
    if (cap > max + 1) cap = max + 1;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    *overflow = 0;
    for (;;) {
        if (len == cap) {
            if (cap > max) { *overflow = 1; break; }
            size_t ncap = cap * 2;
            if (ncap > max + 1) ncap = max + 1;
            char *nb = realloc(buf, ncap);
            if (!nb) { free(buf); return NULL; }
            buf = nb;
            cap = ncap;
        }
        ssize_t n = conn_read(c, buf + len, cap - len);
        if (n < 0) { free(buf); return NULL; }
        if (n == 0) break;
        len += (size_t)n;
    }
    if (len == cap) { char *nb = realloc(buf, cap + 1); if (!nb) { free(buf); return NULL; } buf = nb; }
    buf[len] = '\0';
    *out_len = len;
    return buf;
}

typedef struct {
    int         status;
    char       *raw;       /* malloc'd; the caller frees */
    size_t      raw_len;
    const char *body;      /* into raw */
    size_t      body_len;
    int         has_location;
    char        location[NET_URL_MAX];
} response;

/* one request/response over one connection. Fills out (whose raw the caller frees). Fails (longjmp) on any
 * transport error or an over-cap response. */
static void do_fetch(deon_ctx *ctx, const url_t *u, const char *accept, const char *cred,
                     const char *target, deon_span span, response *out) {
    memset(out, 0, sizeof(*out));

    conn c;
    open_conn(ctx, u, target, span, &c);

    /* Every part below is already control-free: the target/redirect URL was validated, the host and path
     * come from parsing it, the credential was validated, and the accept string is a constant. */
    sb req = {0};
    sb_puts(&req, "GET ");
    sb_puts(&req, u->path);
    sb_puts(&req, " HTTP/1.0\r\nHost: ");
    sb_puts(&req, u->host);
    if (!default_port(u)) { sb_putc(&req, ':'); sb_puts(&req, u->port); }
    sb_puts(&req, "\r\nAccept: ");
    sb_puts(&req, accept);
    sb_puts(&req, "\r\n");
    if (cred && cred[0]) {
        sb_puts(&req, "Authorization: Bearer ");
        sb_puts(&req, cred);
        sb_puts(&req, "\r\n");
    }
    sb_puts(&req, "Connection: close\r\n\r\n");

    size_t sent = 0;
    while (sent < req.len) {
        ssize_t n = conn_write(&c, req.data + sent, req.len - sent);
        if (n <= 0) { sb_free(&req); conn_close(&c); net_fail(ctx, "Unable to reach resource", target, span); }
        sent += (size_t)n;
    }
    sb_free(&req);

    int overflow = 0;
    size_t total = 0;
    char *raw = read_all_capped(&c, DEON_NET_MAX_RESPONSE, &total, &overflow);
    conn_close(&c);
    if (!raw) net_fail(ctx, "Unable to read resource", target, span);
    if (overflow) { free(raw); net_fail(ctx, "Resource exceeded the maximum response size:", target, span); }

    /* status line: "HTTP/1.x CODE ..." */
    int status = 0;
    char *spc = memchr(raw, ' ', total);
    if (spc) status = atoi(spc + 1);

    /* body starts after the header terminator */
    char *sep = NULL;
    for (size_t i = 0; i + 3 < total; i++) {
        if (raw[i] == '\r' && raw[i + 1] == '\n' && raw[i + 2] == '\r' && raw[i + 3] == '\n') { sep = raw + i + 4; break; }
    }
    size_t header_len = sep ? (size_t)(sep - raw) : total;

    out->status = status;
    out->raw = raw;
    out->raw_len = total;
    out->body = sep ? sep : raw;
    out->body_len = sep ? total - (size_t)(sep - raw) : total;
    out->has_location = header_value(raw, header_len, "location", out->location, sizeof(out->location));
}

deon_str http_get(deon_ctx *ctx, const char *target, const char *kind, const char *token, deon_span span) {
    /* Validate before anything is built, on both the http and https paths. A control byte in either the
     * target or the credential is refused outright — it is the header-injection / smuggling vector — and
     * the raw value is never echoed into the diagnostic. */
    if (!deon_net_input_ok(target))
        deon_fail(ctx, DEON_RESOURCE_IO, "The resource target contains a control character and was refused.", span);
    if (!deon_net_input_ok(token))
        deon_fail(ctx, DEON_RESOURCE_IO, "The authenticator contains a control character and was refused.", span);

    const char *accept;
    if (strcmp(kind, "import") == 0) accept = "text/plain,application/json,application/deon";
    else if (strcmp(kind, "link") == 0) accept = "application/deon";
    else accept = "*/*";

    char cur[NET_URL_MAX];
    if (snprintf(cur, sizeof cur, "%s", target) >= (int)sizeof cur)
        net_fail(ctx, "Resource target is too long:", target, span);

    /* the credential travels with the request; a cross-origin redirect clears it below */
    char cred[1024];
    cred[0] = '\0';
    if (token && token[0]) snprintf(cred, sizeof cred, "%s", token);

    for (int hop = 0; ; hop++) {
        if (hop > NET_MAX_REDIRECTS)
            net_fail(ctx, "Too many redirects for resource", target, span);

        /* a redirect Location became `cur`; re-validate it as tainted input before it is used */
        if (!deon_net_input_ok(cur))
            deon_fail(ctx, DEON_RESOURCE_IO, "A redirect target contains a control character and was refused.", span);

        url_t cu;
        if (parse_url(cur, &cu) != 0)
            net_fail(ctx, "Unable to reach resource", target, span);

        if (strcmp(cu.scheme, "https") == 0) {
#ifndef DEON_NETWORK
            /* https needs TLS, which the dependency-free default build does not carry. Refuse it the way
             * a denied capability is refused (never allowed), not as an IO failure of something allowed. */
            char msg[1280];
            snprintf(msg, sizeof msg,
                "The resource '%s' requires TLS ('https'), which this build does not support: rebuild "
                "deon-c with -DDEON_NETWORK and libtls to fetch over https.", target);
            deon_fail(ctx, DEON_CAPABILITY_DENIED, msg, span);
#endif
        }

        response r;
        do_fetch(ctx, &cu, accept, cred, target, span, &r);

        int is_redirect = (r.status == 301 || r.status == 302 || r.status == 303 ||
                           r.status == 307 || r.status == 308) && r.has_location;
        if (is_redirect) {
            char next[NET_URL_MAX];
            int bad = resolve_url(&cu, r.location, next, sizeof next) != 0;
            free(r.raw);
            if (bad)
                net_fail(ctx, "Unable to follow a redirect for resource", target, span);
            if (!deon_net_input_ok(next))
                deon_fail(ctx, DEON_RESOURCE_IO, "A redirect target contains a control character and was refused.", span);

            url_t nu;
            if (parse_url(next, &nu) != 0)
                net_fail(ctx, "Unable to follow a redirect for resource", target, span);
            if (!same_origin(&cu, &nu))
                cred[0] = '\0'; /* never forward the credential to a new origin */

            snprintf(cur, sizeof cur, "%s", next);
            continue;
        }

        /* terminal response */
        if (r.status < 200 || r.status >= 300) {
            free(r.raw);
            net_fail(ctx, "Resource returned a non-success status:", target, span);
        }
        if (!utf8_valid(r.body, r.body_len)) {
            free(r.raw);
            char msg[1280];
            snprintf(msg, sizeof(msg), "The resource '%s' is not valid UTF-8.", target);
            deon_fail(ctx, DEON_RESOURCE_FORMAT, msg, span);
        }

        deon_str out = arena_str(ctx->a, r.body, r.body_len);
        free(r.raw);
        return out;
    }
}
