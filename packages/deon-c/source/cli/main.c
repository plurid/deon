#if defined(__APPLE__)
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "main.h"
#include "../deon/deon.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <errno.h>

extern char **environ;

/* The defaults are the tool's, not the library's: --output deon, --typed false, --filesystem TRUE,
 * --network false. A file named on a command line was named by a person, so it may read the disk;
 * nothing said it may reach the network. The library grants neither, because a document handed to a
 * library came from somewhere unknown — a document handed to this came from whoever typed the command. */

static const char USAGE[] =
    "Usage: deon <file> [options]\n"
    "       deon convert <source.json> [destination.deon]\n"
    "       deon environment <source.deon> <command...>\n"
    "       deon confile <files...> [--destination confile.deon]\n"
    "       deon exfile <source.deon> [--unsafe-paths]\n"
    "       deon lint <files...> [--warnings-as-errors]\n"
    "\n"
    "Options:\n"
    "  -o, --output <deon|json>\n"
    "  -t, --typed\n"
    "  -f, --filesystem <true|false>\n"
    "  -n, --network <true|false>\n"
    "  -d, --destination <path>\n"
    "  -w, --writeover\n"
    "      --unsafe-paths\n"
    "      --warnings-as-errors\n"
    "  -v, --version\n"
    "  -h, --help\n";

/* #region a growable byte buffer */
typedef struct { char *data; size_t len, cap; } buf;
static void bgrow(buf *b, size_t extra) {
    if (b->len + extra <= b->cap) return;
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->len + extra) cap *= 2;
    b->data = realloc(b->data, cap);
    b->cap = cap;
}
static void bputc(buf *b, char c) { bgrow(b, 1); b->data[b->len++] = c; }
static void bput(buf *b, const char *s, size_t n) { bgrow(b, n); memcpy(b->data + b->len, s, n); b->len += n; }
static void bputs(buf *b, const char *s) { bput(b, s, strlen(s)); }
/* #endregion */

/* #region argument parsing */
static bool has_flag(char **args, int n, const char *a, const char *b) {
    for (int i = 0; i < n; i++)
        if (strcmp(args[i], a) == 0 || (b && strcmp(args[i], b) == 0)) return true;
    return false;
}

static const char *opt_value(char **args, int n, const char *a, const char *b, const char *fallback) {
    for (int i = 0; i < n; i++)
        if ((strcmp(args[i], a) == 0 || (b && strcmp(args[i], b) == 0)) && i + 1 < n) return args[i + 1];
    return fallback;
}

static bool takes_value(const char *a) {
    return strcmp(a, "-o") == 0 || strcmp(a, "--output") == 0 ||
           strcmp(a, "-f") == 0 || strcmp(a, "--filesystem") == 0 ||
           strcmp(a, "-n") == 0 || strcmp(a, "--network") == 0 ||
           strcmp(a, "-d") == 0 || strcmp(a, "--destination") == 0;
}

/* the arguments that are neither options nor the values of options */
static int positional(char **args, int n, char **out, int cap) {
    int k = 0;
    bool skip = false;
    for (int i = 0; i < n && k < cap; i++) {
        if (skip) { skip = false; continue; }
        if (takes_value(args[i])) { skip = true; continue; }
        if (args[i][0] == '-') continue;
        out[k++] = args[i];
    }
    return k;
}
/* #endregion */

/* #region small helpers */
static char *resolve(const char *path) {
    static char buffer[4096];
    if (path[0] == '/') { snprintf(buffer, sizeof(buffer), "%s", path); return buffer; }
    char cwd[4096];
    if (!getcwd(cwd, sizeof(cwd))) { snprintf(buffer, sizeof(buffer), "%s", path); return buffer; }
    snprintf(buffer, sizeof(buffer), "%s/%s", cwd, path);
    return buffer;
}

static char *read_raw(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return NULL; }
    rewind(f);
    char *out = malloc((size_t)sz + 1);
    size_t got = fread(out, 1, (size_t)sz, f);
    fclose(f);
    out[got] = '\0';
    if (out_len) *out_len = got;
    return out;
}

static int write_file(const char *path, const char *data, size_t len) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    size_t wrote = fwrite(data, 1, len, f);
    fclose(f);
    return wrote == len ? 0 : -1;
}

static void mkdir_p(const char *path) {
    char tmp[4096];
    snprintf(tmp, sizeof(tmp), "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') { *p = '\0'; mkdir(tmp, 0755); *p = '/'; }
    }
    mkdir(tmp, 0755);
}

static const char *dirname_of(const char *path, char *out, size_t cap) {
    snprintf(out, cap, "%s", path);
    char *slash = strrchr(out, '/');
    if (slash) { if (slash == out) out[1] = '\0'; else *slash = '\0'; }
    else snprintf(out, cap, ".");
    return out;
}

static void print_diagnostics(const deon_error *e) {
    for (size_t i = 0; i < e->diagnostics_len; i++) {
        deon_diagnostic d = e->diagnostics[i];
        const char *severity = d.severity == 1 ? "warning" : "error";
        fprintf(stderr, "%s:%d:%d %s %s %.*s\n",
                d.span.source ? d.span.source : "<memory>", d.span.line, d.span.column,
                severity, deon_code_name(d.code), (int)d.message.len, d.message.data);
    }
}
/* #endregion */

/* #region environment map */
typedef struct { char **names; char **values; size_t len, cap; } env_map;

static void env_put(env_map *m, const char *name, size_t nlen, const char *value, bool overwrite) {
    for (size_t i = 0; i < m->len; i++) {
        if (strlen(m->names[i]) == nlen && memcmp(m->names[i], name, nlen) == 0) {
            if (overwrite) { free(m->values[i]); m->values[i] = strdup(value); }
            return;
        }
    }
    if (m->len == m->cap) {
        m->cap = m->cap ? m->cap * 2 : 32;
        m->names = realloc(m->names, m->cap * sizeof(char *));
        m->values = realloc(m->values, m->cap * sizeof(char *));
    }
    m->names[m->len] = strndup(name, nlen);
    m->values[m->len] = strdup(value);
    m->len++;
}

static void env_from_process(env_map *m) {
    for (char **e = environ; *e; e++) {
        char *eq = strchr(*e, '=');
        if (!eq) continue;
        env_put(m, *e, (size_t)(eq - *e), eq + 1, true);
    }
}

static deon_pair *env_pairs(env_map *m, size_t *out_len) {
    deon_pair *p = malloc((m->len + 1) * sizeof(deon_pair));
    for (size_t i = 0; i < m->len; i++) { p[i].key = m->names[i]; p[i].value = m->values[i]; }
    *out_len = m->len;
    return p;
}

static void env_free(env_map *m) {
    for (size_t i = 0; i < m->len; i++) { free(m->names[i]); free(m->values[i]); }
    free(m->names); free(m->values);
}
/* #endregion */

static deon_options parse_options(char **args, int n, const char *path, env_map *env,
                                  deon_pair **pairs, size_t *pairs_len, char *base, size_t base_cap) {
    deon_options o;
    memset(&o, 0, sizeof(o));
    o.source_name = resolve(path);
    dirname_of(o.source_name, base, base_cap);
    o.filebase = base;
    o.allow_filesystem = strcmp(opt_value(args, n, "-f", "--filesystem", "true"), "true") == 0;
    o.allow_network = strcmp(opt_value(args, n, "-n", "--network", "false"), "true") == 0;
    env_from_process(env);
    *pairs = env_pairs(env, pairs_len);
    o.environment = *pairs;
    o.environment_len = *pairs_len;
    return o;
}

/* #region JSON output */
static void emit_json_string(FILE *out, deon_str s) {
    fputc('"', out);
    for (size_t i = 0; i < s.len; i++) {
        unsigned char c = (unsigned char)s.data[i];
        switch (c) {
            case '"':  fputs("\\\"", out); break;
            case '\\': fputs("\\\\", out); break;
            case '\n': fputs("\\n", out); break;
            case '\r': fputs("\\r", out); break;
            case '\t': fputs("\\t", out); break;
            case '\b': fputs("\\b", out); break;
            case '\f': fputs("\\f", out); break;
            default:
                if (c < 0x20) fprintf(out, "\\u%04x", c);
                else fputc((char)c, out);
        }
    }
    fputc('"', out);
}

static void jindent(FILE *out, int level) { for (int i = 0; i < level * 4; i++) fputc(' ', out); }

static void emit_json(FILE *out, const deon_value *v, int level) {
    switch (v->kind) {
        case DEON_STRING: emit_json_string(out, v->as.string); break;
        case DEON_BOOL:   fputs(v->as.boolean ? "true" : "false", out); break;
        case DEON_NUMBER: {
            double d = v->as.number;
            if (d == (double)(long long)d) fprintf(out, "%lld", (long long)d);
            else fprintf(out, "%g", d);
            break;
        }
        case DEON_LIST:
            if (v->as.list.len == 0) { fputs("[]", out); break; }
            fputs("[\n", out);
            for (size_t i = 0; i < v->as.list.len; i++) {
                if (i > 0) fputs(",\n", out);
                jindent(out, level + 1);
                emit_json(out, v->as.list.items[i], level + 1);
            }
            fputc('\n', out);
            jindent(out, level);
            fputc(']', out);
            break;
        case DEON_MAP:
            if (v->as.map.len == 0) { fputs("{}", out); break; }
            fputs("{\n", out);
            for (size_t i = 0; i < v->as.map.len; i++) {
                if (i > 0) fputs(",\n", out);
                jindent(out, level + 1);
                emit_json_string(out, v->as.map.keys[i]);
                fputs(": ", out);
                emit_json(out, v->as.map.values[i], level + 1);
            }
            fputc('\n', out);
            jindent(out, level);
            fputc('}', out);
            break;
    }
}
/* #endregion */

/* #region commands */
static int cmd_evaluate(char **args, int n) {
    char *resolved = strdup(resolve(args[0]));
    size_t len;
    char *source = read_raw(resolved, &len);
    if (!source) {
        fprintf(stderr, "%s:1:1 error %s Unable to read '%s'.\n", resolved, deon_code_name(DEON_RESOURCE_IO), resolved);
        free(resolved);
        return 1;
    }

    env_map env = {0};
    deon_pair *pairs; size_t pairs_len;
    char base[4096];
    deon_options o = parse_options(args, n, args[0], &env, &pairs, &pairs_len, base, sizeof(base));
    deon_document *doc = deon_parse_with(source, len, &o);
    free(source);

    int status = 0;
    if (!deon_document_ok(doc)) {
        print_diagnostics(deon_document_error(doc));
        status = 1;
    } else {
        deon_value *root = deon_document_root(doc);
        if (strcmp(opt_value(args, n, "-o", "--output", "deon"), "json") == 0) {
            if (has_flag(args, n, "-t", "--typed")) root = deon_typed(doc, root);
            emit_json(stdout, root, 0);
            fputc('\n', stdout);
        } else {
            size_t slen;
            char *s = deon_stringify(root, NULL, &slen);
            fwrite(s, 1, slen, stdout);
            free(s);
        }
    }
    deon_document_free(doc);
    free(pairs);
    env_free(&env);
    free(resolved);
    return status;
}

static int cmd_convert(char **args, int n) {
    if (n < 2) { fprintf(stderr, "deon: convert requires a source file.\n"); return 1; }
    const char *source = args[1];
    size_t len;
    char *data = read_raw(source, &len);
    if (!data) { fprintf(stderr, "deon: Unable to read '%s'.\n", source); return 1; }

    deon_document *doc = deon_read_json(data, len, source);
    free(data);
    if (!deon_document_ok(doc)) { print_diagnostics(deon_document_error(doc)); deon_document_free(doc); return 1; }

    size_t slen;
    char *written = deon_stringify(deon_document_root(doc), NULL, &slen);
    deon_document_free(doc);

    char *dests[64];
    int dn = positional(args + 2, n - 2, dests, 64);
    int status = 0;
    if (dn > 0) {
        if (write_file(dests[0], written, slen) != 0) { fprintf(stderr, "deon: Unable to write '%s'.\n", dests[0]); status = 1; }
    } else {
        fwrite(written, 1, slen, stdout);
    }
    free(written);
    return status;
}

static bool env_value_of(const deon_value *v, buf *out) {
    if (v->kind == DEON_STRING) { bput(out, v->as.string.data, v->as.string.len); return true; }
    if (v->kind == DEON_LIST) {
        bool first = true;
        for (size_t i = 0; i < v->as.list.len; i++) {
            if (v->as.list.items[i]->kind != DEON_STRING) continue;
            if (!first) bputc(out, ':');
            first = false;
            deon_str s = v->as.list.items[i]->as.string;
            bput(out, s.data, s.len);
        }
        return true;
    }
    return false;
}

static int cmd_environment(char **args, int n) {
    if (n < 3) { fprintf(stderr, "deon: environment requires a source file and a command.\n"); return 1; }
    const char *source = args[1];

    deon_options empty;
    memset(&empty, 0, sizeof(empty));
    deon_document *doc = deon_parse_file(source, &empty);
    if (!deon_document_ok(doc)) { print_diagnostics(deon_document_error(doc)); deon_document_free(doc); return 1; }
    deon_value *root = deon_document_root(doc);
    if (root->kind != DEON_MAP) { fprintf(stderr, "deon: An environment source must contain a root map.\n"); deon_document_free(doc); return 1; }

    env_map env = {0};
    env_from_process(&env);
    bool writeover = has_flag(args, n, "-w", "--writeover");
    for (size_t i = 0; i < root->as.map.len; i++) {
        buf value = {0};
        if (!env_value_of(root->as.map.values[i], &value)) { free(value.data); continue; }
        bputc(&value, '\0');
        deon_str name = root->as.map.keys[i];
        env_put(&env, name.data, name.len, value.data, writeover);
        free(value.data);
    }
    deon_document_free(doc);

    /* everything after the source is the command, verbatim, with only this command's own flag removed */
    char *command[256];
    int cn = 0;
    for (int i = 2; i < n && cn < 255; i++) {
        if (strcmp(args[i], "-w") == 0 || strcmp(args[i], "--writeover") == 0) continue;
        command[cn++] = args[i];
    }
    command[cn] = NULL;
    if (cn == 0) { fprintf(stderr, "deon: environment requires a command to run.\n"); env_free(&env); return 1; }

    char **envp = malloc((env.len + 1) * sizeof(char *));
    for (size_t i = 0; i < env.len; i++) {
        size_t l = strlen(env.names[i]) + strlen(env.values[i]) + 2;
        envp[i] = malloc(l);
        snprintf(envp[i], l, "%s=%s", env.names[i], env.values[i]);
    }
    envp[env.len] = NULL;

    pid_t pid = fork();
    if (pid == 0) {
        environ = envp;
        execvp(command[0], command);
        fprintf(stderr, "deon: Unable to run '%s': %s\n", command[0], strerror(errno));
        _exit(127);
    }
    int wstatus = 0;
    waitpid(pid, &wstatus, 0);
    for (size_t i = 0; i < env.len; i++) free(envp[i]);
    free(envp);
    env_free(&env);
    if (WIFEXITED(wstatus)) return WEXITSTATUS(wstatus);
    return 1;
}

/* append `text` into `b` as the body of a single-quoted Deon string (without the quotes) */
static void quote_into(buf *b, const char *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        char c = data[i];
        if (c == '\\') bputs(b, "\\\\");
        else if (c == '\'') bputs(b, "\\'");
        else if (c == '\n') bputs(b, "\\n");
        else if (c == '\r') bputs(b, "\\r");
        else if (c == '\t') bputs(b, "\\t");
        else bputc(b, c);
    }
}

static int cmd_confile(char **args, int n) {
    const char *destination = opt_value(args, n, "-d", "--destination", "confile.deon");

    char *pos[256];
    int pn = positional(args + 1, n - 1, pos, 256);
    char *files[256];
    int fn = 0;
    for (int i = 0; i < pn; i++) if (strcmp(pos[i], destination) != 0) files[fn++] = pos[i];
    if (fn == 0) { fprintf(stderr, "deon: confile requires at least one input file.\n"); return 1; }

    /* Assemble the confile as Deon source keyed by the path as typed, then parse and stringify with the
     * same writer the other tools use, so exfile puts each file back where it came from. */
    buf text = {0};
    bputs(&text, "{\n");
    for (int i = 0; i < fn; i++) {
        size_t dl;
        char *data = read_raw(files[i], &dl);
        if (!data) { fprintf(stderr, "deon: Unable to read '%s'.\n", files[i]); free(text.data); return 1; }
        bputs(&text, "    '");
        quote_into(&text, files[i], strlen(files[i]));
        bputs(&text, "' {\n        data '");
        quote_into(&text, data, dl);
        bputs(&text, "'\n    }\n");
        free(data);
    }
    bputs(&text, "}\n");

    deon_document *cd = deon_parse(text.data, text.len);
    free(text.data);
    if (!deon_document_ok(cd)) { print_diagnostics(deon_document_error(cd)); deon_document_free(cd); return 1; }
    size_t slen;
    char *written = deon_stringify(deon_document_root(cd), NULL, &slen);
    deon_document_free(cd);
    int status = write_file(destination, written, slen);
    free(written);
    if (status != 0) { fprintf(stderr, "deon: Unable to write '%s'.\n", destination); return 1; }
    return 0;
}

static bool exfile_data(const deon_value *entry, deon_str *out) {
    if (entry->kind == DEON_STRING) { *out = entry->as.string; return true; }
    if (entry->kind == DEON_MAP) {
        deon_value *data = deon_map_get(entry, "data");
        if (data && data->kind == DEON_STRING) { *out = data->as.string; return true; }
    }
    return false;
}

/* true when a cleaned relative path rises above its starting directory */
static bool path_escapes(const char *path) {
    int depth = 0;
    const char *p = path;
    while (*p) {
        const char *start = p;
        while (*p && *p != '/') p++;
        size_t seg = (size_t)(p - start);
        if (seg == 2 && start[0] == '.' && start[1] == '.') { depth--; if (depth < 0) return true; }
        else if (!(seg == 0 || (seg == 1 && start[0] == '.'))) depth++;
        if (*p == '/') p++;
    }
    return false;
}

static int cmd_exfile(char **args, int n) {
    if (n < 2) { fprintf(stderr, "deon: exfile requires a source file.\n"); return 1; }
    const char *source = args[1];
    bool unsafe = has_flag(args, n, "--unsafe-paths", NULL);

    deon_options empty;
    memset(&empty, 0, sizeof(empty));
    deon_document *doc = deon_parse_file(source, &empty);
    if (!deon_document_ok(doc)) { print_diagnostics(deon_document_error(doc)); deon_document_free(doc); return 1; }
    deon_value *root = deon_document_root(doc);
    if (root->kind != DEON_MAP) { fprintf(stderr, "deon: An exfile source must contain a root map.\n"); deon_document_free(doc); return 1; }

    /* Every entry is checked before any is written, so a document with one bad path writes nothing. */
    for (size_t i = 0; i < root->as.map.len; i++) {
        deon_str key = root->as.map.keys[i];
        char path[4096];
        snprintf(path, sizeof(path), "%.*s", (int)key.len, key.data);
        deon_str data;
        if (!exfile_data(root->as.map.values[i], &data)) {
            fprintf(stderr, "deon: Exfile entry '%s' must be a string or a map with a string data field.\n", path);
            deon_document_free(doc);
            return 1;
        }
        if (!unsafe && (path[0] == '/' || path_escapes(path))) {
            fprintf(stderr, "deon: Unsafe exfile path '%s'. Use --unsafe-paths to permit it.\n", path);
            deon_document_free(doc);
            return 1;
        }
    }

    for (size_t i = 0; i < root->as.map.len; i++) {
        deon_str key = root->as.map.keys[i];
        char path[4096];
        snprintf(path, sizeof(path), "%.*s", (int)key.len, key.data);
        deon_str data;
        exfile_data(root->as.map.values[i], &data);
        char dir[4096];
        dirname_of(path, dir, sizeof(dir));
        if (strcmp(dir, ".") != 0 && dir[0] != '\0') mkdir_p(dir);
        if (write_file(path, data.data, data.len) != 0) {
            fprintf(stderr, "deon: Unable to write '%s'.\n", path);
            deon_document_free(doc);
            return 1;
        }
    }
    deon_document_free(doc);
    return 0;
}

static int cmd_lint(char **args, int n) {
    char *files[256];
    int fn = positional(args + 1, n - 1, files, 256);
    if (fn == 0) { fprintf(stderr, "deon: lint requires at least one file.\n"); return 1; }

    bool warnings_are_errors = has_flag(args, n, "--warnings-as-errors", NULL);
    bool warned = false;

    for (int i = 0; i < fn; i++) {
        char *resolved = strdup(resolve(files[i]));
        size_t len;
        char *source = read_raw(resolved, &len);
        if (!source) {
            fprintf(stderr, "%s:1:1 error %s Unable to read '%s'.\n", resolved, deon_code_name(DEON_RESOURCE_IO), resolved);
            free(resolved);
            return 1;
        }

        const deon_diagnostic *lints;
        size_t lint_len;
        deon_document *ld = deon_lint_document(source, len, resolved, &lints, &lint_len);
        for (size_t j = 0; j < lint_len; j++) {
            warned = true;
            const char *severity = lints[j].severity == 1 ? "warning" : "error";
            printf("%s:%d:%d %s %s %.*s\n", resolved, lints[j].span.line, lints[j].span.column,
                   severity, deon_code_name(lints[j].code), (int)lints[j].message.len, lints[j].message.data);
        }
        deon_document_free(ld);

        /* Linting reports what is legal and questionable; evaluation surfaces what is wrong. */
        env_map env = {0};
        deon_pair *pairs; size_t pairs_len;
        char base[4096];
        deon_options o = parse_options(args, n, files[i], &env, &pairs, &pairs_len, base, sizeof(base));
        deon_document *pd = deon_parse_with(source, len, &o);
        free(source);
        int failed = 0;
        if (!deon_document_ok(pd)) { print_diagnostics(deon_document_error(pd)); failed = 1; }
        deon_document_free(pd);
        free(pairs);
        env_free(&env);
        free(resolved);
        if (failed) return 1;
    }

    if (warned && warnings_are_errors) return 1;
    return 0;
}
/* #endregion */

int deon_cli(int argc, char **argv) {
    char **args = argv + 1;
    int n = argc - 1;

    if (n == 0 || has_flag(args, n, "-h", "--help")) { fputs(USAGE, stdout); return 0; }
    if (has_flag(args, n, "-v", "--version")) { printf("%s\n", DEON_VERSION); return 0; }

    if (strcmp(args[0], "convert") == 0) return cmd_convert(args, n);
    if (strcmp(args[0], "environment") == 0) return cmd_environment(args, n);
    if (strcmp(args[0], "confile") == 0) return cmd_confile(args, n);
    if (strcmp(args[0], "exfile") == 0) return cmd_exfile(args, n);
    if (strcmp(args[0], "lint") == 0) return cmd_lint(args, n);
    return cmd_evaluate(args, n);
}
