#include <stdio.h>
#include <stdlib.h>
#include <getopt.h>



int main(
    int argc,
    char* argv[]
) {
    int c;

    while (1) {
        static struct option long_options[] = {
            {"version", no_argument, 0, 1},
            {"output", no_argument, 0, 1},
            {"typed", no_argument, 0, 1},
            {"help", no_argument, 0, 1},
        };

        /* getopt_long stores the option index here. */
        int option_index = 0;

        c = getopt_long(
            argc,
            argv,
            "abc:d:f:",
            long_options,
            &option_index
        );

        switch (c) {
            default:
                printf("%d", c);
                break;
        }

        break;
    }
}
