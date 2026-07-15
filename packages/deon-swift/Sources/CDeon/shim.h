/* The header Swift imports as the module `CDeon`. It is deon-c's own public header, included in place —
 * this package binds to that implementation rather than reimplementing it — plus one portability shim:
 * the process environment table, which Swift's platform overlays expose differently on macOS and Linux. */

#include "../../../deon-c/source/deon/deon.h"

#if defined(__APPLE__)
#include <crt_externs.h>
static inline char **deon_environ(void) { return *_NSGetEnviron(); }
#else
extern char **environ;
static inline char **deon_environ(void) { return environ; }
#endif
