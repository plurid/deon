#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <arpa/inet.h>

/* The network path over loopback servers. Nothing else exercises the socket: the differential harness
 * uses in-memory resources, and every fixture that names the network is a denial. So this test binds two
 * servers to 127.0.0.1, never anything routable, and drives an import, a link, a non-success status, a
 * denial, the response-size cap, the redirect cap, and cross-origin credential non-forwarding through
 * them. It also unit-tests the pure input-validation logic, which needs no socket at all.
 *
 * The response cap is shrunk at build time (see the Makefile's `network` target: -DDEON_NET_MAX_RESPONSE)
 * so the over-cap case is a small, fast transfer; the capping code under test is identical. */

/* the network client's input validators, defined in network.c (external linkage) */
extern bool deon_net_input_ok(const char *s);
extern bool deon_net_bytes_ok(const char *s, size_t len);

static int failures = 0;
static void check(bool ok, const char *what) {
    if (ok) printf("ok   %s\n", what);
    else { printf("FAIL %s\n", what); failures++; }
}

static void write_all(int fd, const char *data, size_t len) {
    size_t off = 0;
    while (off < len) { ssize_t w = write(fd, data + off, len - off); if (w <= 0) break; off += (size_t)w; }
}

/* One loopback server. `self_port` is its own port; `other_port` is its sibling's, used to build a
 * cross-origin redirect. */
static void serve(int listener, int self_port, int other_port) {
    (void)self_port;
    signal(SIGPIPE, SIG_IGN);
    for (;;) {
        int fd = accept(listener, NULL, NULL);
        if (fd < 0) continue;
        char req[2048];
        ssize_t n = read(fd, req, sizeof(req) - 1);
        if (n <= 0) { close(fd); continue; }
        req[n] = '\0';

        int has_auth = strstr(req, "Authorization:") != NULL;

        /* Route on substrings, not exact request lines: an extension-less import target (e.g. /huge) is
         * fetched by the interpreter as /huge.deon, while a redirect Location is fetched verbatim, so a
         * given endpoint is reached under both spellings. */

        /* an over-cap body: streamed so it never fits a single buffer, and larger than the test cap */
        if (strstr(req, "/huge")) {
            const char *hdr = "HTTP/1.0 200 OK\r\nContent-Type: application/deon\r\nConnection: close\r\n\r\n";
            write_all(fd, hdr, strlen(hdr));
            char chunk[8192];
            memset(chunk, 'x', sizeof chunk);
            size_t remaining = 256 * 1024; /* > the 64 KiB test cap */
            while (remaining) {
                size_t want = remaining < sizeof chunk ? remaining : sizeof chunk;
                ssize_t k = write(fd, chunk, want);
                if (k <= 0) break;
                remaining -= (size_t)k;
            }
            close(fd);
            continue;
        }

        char response[8192];
        int len;
        if (strstr(req, "/goto-child")) {
            /* same-origin redirect to a real document */
            len = snprintf(response, sizeof response,
                "HTTP/1.0 302 Found\r\nLocation: /child.deon\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno");
        } else if (strstr(req, "/same-redir")) {
            /* same-origin redirect: the credential should still travel */
            len = snprintf(response, sizeof response,
                "HTTP/1.0 302 Found\r\nLocation: /reflect-auth\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno");
        } else if (strstr(req, "/xorigin")) {
            /* cross-origin redirect (different port = different origin): the credential must be dropped */
            char loc[128];
            snprintf(loc, sizeof loc, "http://127.0.0.1:%d/reflect-auth", other_port);
            len = snprintf(response, sizeof response,
                "HTTP/1.0 302 Found\r\nLocation: %s\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno", loc);
        } else if (strstr(req, "/redir-loop")) {
            /* an endless redirect: the client must give up at the cap */
            len = snprintf(response, sizeof response,
                "HTTP/1.0 302 Found\r\nLocation: /redir-loop\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno");
        } else if (strstr(req, "/reflect-auth")) {
            /* echo whether the request carried an Authorization header, as a one-key document */
            const char *body = has_auth ? "{\n    seen AUTH\n}\n" : "{\n    seen NOAUTH\n}\n";
            len = snprintf(response, sizeof response,
                "HTTP/1.0 200 OK\r\nContent-Type: application/deon\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
                strlen(body), body);
        } else {
            const char *body = "{\n    inner value\n}\n";
            const char *status = "200 OK";
            const char *ctype = "application/deon";
            if (strstr(req, "/data.json ")) { body = "{\"n\": 1.50}"; ctype = "application/json"; }
            else if (strstr(req, "/missing")) { status = "404 Not Found"; body = "no"; }
            len = snprintf(response, sizeof response,
                "HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n%s",
                status, ctype, strlen(body), body);
        }
        if (len > 0) write_all(fd, response, (size_t)len);
        close(fd);
    }
}

static int bind_loopback(int *out_port) {
    int listener = socket(AF_INET, SOCK_STREAM, 0);
    int one = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* 127.0.0.1 — never a routable address */
    addr.sin_port = 0;
    if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); return -1; }
    if (listen(listener, 8) != 0) { perror("listen"); return -1; }
    socklen_t alen = sizeof(addr);
    getsockname(listener, (struct sockaddr *)&addr, &alen);
    *out_port = ntohs(addr.sin_port);
    return listener;
}

int main(void) {
    /* #region pure input validation — no socket needed
     * A control byte in the target or the authenticator is the header-injection / request-smuggling
     * vector; it must be refused before any request is built. */
    check(deon_net_input_ok("http://127.0.0.1/x"), "clean target accepted");
    check(!deon_net_input_ok("http://h/a\rb"), "CR in target rejected");
    check(!deon_net_input_ok("http://h/a\nb"), "LF in target rejected");
    check(!deon_net_input_ok("http://h/a\tb"), "TAB in target rejected");
    check(!deon_net_input_ok("http://h/a\001b"), "control byte in target rejected");
    check(!deon_net_input_ok("http://h/a\177b"), "DEL in target rejected");
    check(deon_net_input_ok("Bearer abc.def-123~/+"), "clean authenticator accepted");
    check(!deon_net_input_ok("tok\r\nX-Evil: y"), "CRLF in authenticator rejected");
    check(!deon_net_input_ok("tok\nX-Evil: y"), "LF in authenticator rejected");
    check(deon_net_input_ok(""), "empty string accepted");
    check(deon_net_input_ok(NULL), "NULL accepted");
    { const char nul[] = {'a', '\0', 'b'}; check(!deon_net_bytes_ok(nul, sizeof nul), "embedded NUL rejected (byte form)"); }
    /* #endregion */

    int portA = 0, portB = 0;
    int listenerA = bind_loopback(&portA);
    int listenerB = bind_loopback(&portB);
    if (listenerA < 0 || listenerB < 0) return 2;

    pid_t serverA = fork();
    if (serverA == 0) { close(listenerB); serve(listenerA, portA, portB); _exit(0); }
    pid_t serverB = fork();
    if (serverB == 0) { close(listenerA); serve(listenerB, portB, portA); _exit(0); }
    close(listenerA);
    close(listenerB);

    char base[64];
    snprintf(base, sizeof(base), "http://127.0.0.1:%d", portA);

    deon_options net;
    memset(&net, 0, sizeof(net));
    net.allow_network = true;

    /* a bearer token per hostname; the client attaches it to a same-host request */
    deon_pair auth[] = {{"127.0.0.1", "secrettoken"}};
    deon_options net_auth = net;
    net_auth.authorization = auth;
    net_auth.authorization_len = 1;

    /* an import over the network is evaluated and spread */
    {
        char src[256];
        snprintf(src, sizeof(src), "import c from %s/child.deon\n{\n    ...#c\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        deon_value *inner = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "inner") : NULL;
        check(inner && inner->kind == DEON_STRING && strncmp(inner->as.string.data, "value", 5) == 0, "import over http");
        deon_document_free(d);
    }

    /* an injected JSON resource keeps its number's source spelling */
    {
        char src[256];
        snprintf(src, sizeof(src), "import j from %s/data.json\n{\n    ...#j\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        deon_value *nn = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "n") : NULL;
        check(nn && nn->kind == DEON_STRING && nn->as.string.len == 4 && memcmp(nn->as.string.data, "1.50", 4) == 0, "json import preserves spelling");
        deon_document_free(d);
    }

    /* a non-success status is DEON_RESOURCE_IO: it was allowed and it failed */
    {
        char src[256];
        snprintf(src, sizeof(src), "import m from %s/missing\n{\n    #m\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_RESOURCE_IO, "non-success status is RESOURCE_IO");
        deon_document_free(d);
    }

    /* parse_link fetches and evaluates a document by URL */
    {
        char link[128];
        snprintf(link, sizeof(link), "%s/child.deon", base);
        deon_document *d = deon_parse_link(link, &net);
        deon_value *inner = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "inner") : NULL;
        check(inner && inner->kind == DEON_STRING, "parse_link over http");
        deon_document_free(d);
    }

    /* the network is refused before any socket opens when it was not granted */
    {
        char src[256];
        snprintf(src, sizeof(src), "import c from %s/child.deon\n{\n    #c\n}\n", base);
        deon_document *d = deon_parse(src, strlen(src));
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_CAPABILITY_DENIED, "network denied by default");
        deon_document_free(d);
    }

    /* https needs TLS, which the dependency-free default build does not carry: it is refused as an
     * unsupported capability (DEON_CAPABILITY_DENIED), never attempted in plaintext. Under -DDEON_NETWORK
     * this same target would instead speak real TLS, so the assertion is specific to the default build. */
#ifndef DEON_NETWORK
    {
        char src[256];
        snprintf(src, sizeof(src), "import s from https://127.0.0.1:%d/child.deon\n{\n    ...#s\n}\n", portA);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_CAPABILITY_DENIED,
              "https refused as unsupported capability in the dependency-free build");
        deon_document_free(d);
    }
#endif

    /* a redirect is followed to the real document */
    {
        char src[256];
        snprintf(src, sizeof(src), "import x from %s/goto-child\n{\n    ...#x\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        deon_value *inner = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "inner") : NULL;
        check(inner && inner->kind == DEON_STRING && strncmp(inner->as.string.data, "value", 5) == 0, "redirect followed to child");
        deon_document_free(d);
    }

    /* an endless redirect is abandoned at the cap, as a resource error */
    {
        char src[256];
        snprintf(src, sizeof(src), "import x from %s/redir-loop\n{\n    ...#x\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_RESOURCE_IO, "redirect cap exceeded is RESOURCE_IO");
        deon_document_free(d);
    }

    /* a response larger than the cap is a resource error, not an unbounded allocation */
    {
        char src[256];
        snprintf(src, sizeof(src), "import x from %s/huge\n{\n    ...#x\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net);
        check(!deon_document_ok(d) && deon_document_error(d)->code == DEON_RESOURCE_IO, "response size cap exceeded is RESOURCE_IO");
        deon_document_free(d);
    }

    /* a same-origin redirect still forwards the credential */
    {
        char src[256];
        snprintf(src, sizeof(src), "import x from %s/same-redir\n{\n    ...#x\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net_auth);
        deon_value *seen = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "seen") : NULL;
        check(seen && seen->kind == DEON_STRING && strncmp(seen->as.string.data, "AUTH", 4) == 0 && seen->as.string.len == 4,
              "credential forwarded on same-origin redirect");
        deon_document_free(d);
    }

    /* a cross-origin redirect (different port) must NOT forward the credential */
    {
        char src[256];
        snprintf(src, sizeof(src), "import x from %s/xorigin\n{\n    ...#x\n}\n", base);
        deon_document *d = deon_parse_with(src, strlen(src), &net_auth);
        deon_value *seen = deon_document_ok(d) ? deon_map_get(deon_document_root(d), "seen") : NULL;
        check(seen && seen->kind == DEON_STRING && strncmp(seen->as.string.data, "NOAUTH", 6) == 0,
              "credential NOT forwarded across origins");
        deon_document_free(d);
    }

    kill(serverA, SIGTERM);
    kill(serverB, SIGTERM);
    waitpid(serverA, NULL, 0);
    waitpid(serverB, NULL, 0);

    if (failures == 0) { printf("\nall network cases passed\n"); return 0; }
    fprintf(stderr, "\n%d network failure(s)\n", failures);
    return 1;
}
