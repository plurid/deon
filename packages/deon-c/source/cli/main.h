#ifndef DEON_CLI_MAIN_H
#define DEON_CLI_MAIN_H

/* The `deon` command line tool. Its surface is the same as the JavaScript, Rust, Python, and Go tools,
 * command for command, and scripts/cli-harness.py holds the five to one behaviour. */
int deon_cli(int argc, char **argv);

#endif
