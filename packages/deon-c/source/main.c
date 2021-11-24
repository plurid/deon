#include <stdio.h>

#include "cli/main.c"



int main(
    int argc,
    char* argv[]
) {
    int arguments = read_arguments(argc, argv);
    printf("arguments %d", arguments);
}
