/* An incompatible image that exposes descriptor/env leakage and leaves a child. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#ifndef MARKER
#error MARKER must identify a test-owned path
#endif
int main(void) {
    int descriptors = 0;
    int limit = getdtablesize();
    for (int fd = 3; fd < limit; fd++) {
        if (fcntl(fd, F_GETFD) >= 0) descriptors++;
    }
    pid_t child = fork();
    if (child < 0) return 1;
    if (child == 0) { for (;;) pause(); }
    FILE *file = fopen(MARKER, "w");
    if (!file) return 2;
    fprintf(file, "%d %d %d\n", child, descriptors, getenv("HOME") != NULL);
    if (fclose(file) != 0) return 3;
    puts("{}");
    return 0;
}
