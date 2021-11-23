#include<stdio.h>



int main(
    int argc,
    char* argv[]
) {
    printf("arguments number: %d", argc);
    printf("\n");

    for (int i = 0; i < argc; i++) {
        printf("argument: %s", argv[i]);
        printf("\n");
    }
}
