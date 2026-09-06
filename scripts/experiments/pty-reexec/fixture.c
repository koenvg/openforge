/* Only launched by the isolated reexec experiment. No app integration. */
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile sig_atomic_t stopped;
static void stop(int sig) { stopped = sig; }

int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    if (argc < 2) return 64;
    if (!strcmp(argv[1], "audit")) {
        printf("FDS");
        for (int fd = 0; fd < getdtablesize(); fd++)
            if (fcntl(fd, F_GETFD) >= 0) printf(" %d", fd);
        puts(" END");
        return 0;
    }
    if (!strcmp(argv[1], "exit")) {
        if (argc != 3) return 64;
        struct sigaction action = {.sa_handler = stop};
        sigemptyset(&action.sa_mask);
        if (sigaction(SIGUSR1, &action, NULL)) return 70;
        sigset_t blocked, previous;
        sigemptyset(&blocked);
        sigaddset(&blocked, SIGUSR1);
        if (sigprocmask(SIG_BLOCK, &blocked, &previous)) return 70;
        puts("EXIT_READY");
        while (!stopped) sigsuspend(&previous);
        return atoi(argv[2]);
    }
    if (!strcmp(argv[1], "tool")) {
        unsigned long tick = 0;
        while (1) {
            printf("TOOL %d %lu\n", getpid(), tick++);
            usleep(20000);
        }
    }
    if (strcmp(argv[1], "agent")) return 64;
    struct sigaction action = {.sa_handler = stop};
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL)) return 70;
    pid_t tool = fork();
    if (tool < 0) return 70;
    if (!tool) {
        execl(argv[0], argv[0], "tool", NULL);
        _exit(127);
    }
    printf("AGENT %d TOOL_PID %d\n", getpid(), tool);
    /* The tool runs concurrently with the agent's input loop. */
    char line[256];
    while (!stopped && fgets(line, sizeof(line), stdin))
        printf("AGENT_ECHO %s", line);
    /* Group termination reaches the tool too; reap it before exiting. */
    if (kill(tool, SIGTERM) && errno != ESRCH) return 70;
    int status;
    while (waitpid(tool, &status, 0) < 0) if (errno != EINTR) return 70;
    printf("TOOL_REAPED %d\n", WIFSIGNALED(status) ? WTERMSIG(status) : 0);
    return stopped ? 128 + stopped : 0;
}
