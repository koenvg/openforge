/* macOS-only feasibility host. The line protocol is private to run.py. */
#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <util.h>

#ifndef VERSION
#define VERSION 1
#endif
#define COUNT 5
#define MAGIC 0x50545931

struct child {
    pid_t pid;
    uint64_t sec, usec, cursor;
    int master, reaped, status;
    char tty[128];
};
struct checkpoint {
    unsigned magic;
    pid_t host;
    int state_fd, sentinel;
    struct child children[COUNT];
};
static struct checkpoint state;
static const char *fixture;

static bool identity(struct child *child) {
    struct proc_bsdinfo info;
    return proc_pidinfo(child->pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info)
        && info.pbi_ppid == (unsigned)getpid() && info.pbi_uid == getuid()
        && info.pbi_start_tvsec == child->sec && info.pbi_start_tvusec == child->usec;
}

static void reap(void) {
    for (int i = 0; i < COUNT; i++) {
        struct child *child = &state.children[i];
        if (!child->pid || child->reaped) continue;
        pid_t result = waitpid(child->pid, &child->status, WNOHANG);
        if (result == child->pid) child->reaped = 1;
        else if (result < 0 && errno != EINTR) { perror("waitpid"); exit(70); }
    }
}

static void terminate(int index, int sig) {
    struct child *child = &state.children[index];
    /* An unreaped direct child pins its PID. Never signal a saved/reaped PID. */
    if (child->pid && !child->reaped && identity(child)) {
        if (getpgid(child->pid) != child->pid) { fputs("foreign group\n", stderr); exit(70); }
        if (kill(-child->pid, sig) && errno != ESRCH) { perror("killpg"); exit(70); }
    }
}

static void cleanup(void) {
    for (int i = 0; i < COUNT; i++) terminate(i, SIGTERM);
    for (int n = 0; n < 100; n++) { reap(); usleep(10000); }
    for (int i = 0; i < COUNT; i++) terminate(i, SIGKILL);
    for (int i = 0; i < COUNT; i++) {
        struct child *child = &state.children[i];
        /* macOS tty teardown can wait for the master to close. */
        if (child->master >= 0) { close(child->master); child->master = -1; }
        if (child->pid && !child->reaped) {
            while (waitpid(child->pid, &child->status, 0) < 0)
                if (errno != EINTR) break;
            child->reaped = 1;
        }
        if (child->master >= 0) close(child->master);
    }
}

static void fail(const char *operation) { perror(operation); cleanup(); exit(70); }

static void spawn(int index, int code) {
    struct child *child = &state.children[index];
    if (child->pid) { errno = EEXIST; fail("occupied slot"); }
    int slave;
    struct winsize size = {.ws_row = 24, .ws_col = 80};
    if (openpty(&child->master, &slave, child->tty, NULL, &size)) fail("openpty");
    child->pid = fork();
    if (child->pid < 0) { child->pid = 0; fail("fork"); }
    if (!child->pid) {
        if (setsid() < 0 || ioctl(slave, TIOCSCTTY, 0) < 0) _exit(126);
        for (int fd = 0; fd < 3; fd++) if (dup2(slave, fd) < 0) _exit(126);
        /* Close everything, including other masters and the checkpoint. */
        for (int fd = 3; fd < getdtablesize(); fd++) close(fd);
        if (index == 0) {
            execl("/bin/bash", "bash", "--noprofile", "--norc", "-i", NULL);
        } else if (index == 1) {
            execl(fixture, fixture, "agent", NULL);
        } else {
            char status[16];
            snprintf(status, sizeof(status), "%d", code);
            execl(fixture, fixture, "exit", status, NULL);
        }
        _exit(127);
    }
    close(slave);
    struct proc_bsdinfo info;
    if (proc_pidinfo(child->pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) fail("child identity");
    child->sec = info.pbi_start_tvsec;
    child->usec = info.pbi_start_tvusec;
    /* This is only a fixture; all masters remain blocking and single-owned. */
}

static void inventory(void) {
    reap();
    printf("{\"version\":%d,\"host\":%d,\"fds\":[", VERSION, getpid());
    bool first = true;
    for (int fd = 0; fd < getdtablesize(); fd++) {
        if (fcntl(fd, F_GETFD) < 0) continue;
        printf("%s%d", first ? "" : ",", fd); first = false;
    }
    printf("],\"stateFd\":%d,\"sentinel\":%d,\"children\":[", state.state_fd, state.sentinel);
    for (int i = 0; i < COUNT; i++) {
        struct child *child = &state.children[i];
        struct stat st = {0};
        if (child->master >= 0 && fstat(child->master, &st)) fail("fstat master");
        printf("%s{\"pid\":%d,\"fd\":%d,\"tty\":\"%s\",\"device\":%llu,\"cursor\":%llu,\"reaped\":%d,\"status\":%d}",
            i ? "," : "", child->pid, child->master, child->tty,
            (unsigned long long)st.st_rdev, (unsigned long long)child->cursor, child->reaped, child->status);
    }
    puts("]}");
}

static void read_pty(int index) {
    struct child *child = &state.children[index];
    struct pollfd descriptor = {.fd = child->master, .events = POLLIN};
    int ready = poll(&descriptor, 1, 100);
    if (ready < 0) fail("poll");
    unsigned char bytes[4096];
    ssize_t length = 0;
    if (ready && (descriptor.revents & (POLLIN | POLLHUP))) {
        length = read(child->master, bytes, sizeof(bytes));
        if (length < 0 && errno == EIO) length = 0;
        if (length < 0) fail("read PTY");
    }
    printf("{\"cursor\":%llu,\"hex\":\"", (unsigned long long)child->cursor);
    for (ssize_t i = 0; i < length; i++) printf("%02x", bytes[i]);
    child->cursor += (uint64_t)length;
    puts("\"}");
}

static void write_pty(int index, const char *hex) {
    size_t length = strlen(hex);
    if (length % 2) { errno = EINVAL; fail("hex length"); }
    for (size_t i = 0; i < length; i += 2) {
        unsigned int byte;
        if (sscanf(hex + i, "%2x", &byte) != 1) { errno = EINVAL; fail("hex byte"); }
        unsigned char value = (unsigned char)byte;
        if (write(state.children[index].master, &value, 1) != 1) fail("write PTY");
    }
    puts("{\"ok\":true}");
}

static void replace_image(const char *target) {
    /* No threads or userspace PTY buffers: command completion is quiescence. */
    reap();
    if (pwrite(state.state_fd, &state, sizeof(state), 0) != sizeof(state)) fail("checkpoint write");
    for (int fd = 3; fd < getdtablesize(); fd++) {
        int flags = fcntl(fd, F_GETFD);
        if (flags < 0) continue;
        bool keep = fd == state.state_fd;
        for (int i = 0; i < COUNT; i++) keep |= fd == state.children[i].master;
        if (fcntl(fd, F_SETFD, keep ? flags & ~FD_CLOEXEC : flags | FD_CLOEXEC)) fail("descriptor allowlist");
    }
    puts("{\"prepared\":true}");
    char go[16];
    if (!fgets(go, sizeof(go), stdin)) { cleanup(); exit(0); }
    if (!strcmp(go, "ABORT\n")) { inventory(); return; }
    if (strcmp(go, "GO\n")) { errno = EINVAL; fail("GO barrier"); }
#ifdef NO_REEXEC
    (void)target;
    inventory();
#else
    char descriptor[32];
    snprintf(descriptor, sizeof(descriptor), "%d", state.state_fd);
    execl(target, target, descriptor, fixture, NULL);
    /* Failed exec leaves the old image and all sessions usable. */
    printf("{\"execError\":%d}\n", errno);
#endif
}

int main(int argc, char **argv) {
    setbuf(stdin, NULL);
    setbuf(stdout, NULL);
    for (int i = 0; i < COUNT; i++) state.children[i].master = -1;
    if (argc != 3) return 64;
    fixture = argv[2];
    if (!strcmp(argv[1], "start")) {
        state.magic = MAGIC;
        state.host = getpid();
        state.state_fd = open("checkpoint", O_RDWR | O_CREAT | O_EXCL, 0600);
        if (state.state_fd < 0 || unlink("checkpoint")) fail("checkpoint");
        /* Deliberately inheritable: replacement must apply its allowlist. */
        state.sentinel = open("unrelated-secret", O_RDWR | O_CREAT | O_EXCL, 0600);
        if (state.sentinel < 0) fail("sentinel");
        spawn(0, 0);
        spawn(1, 0);
    } else {
        char *end;
        long fd = strtol(argv[1], &end, 10);
        if (*end || fd < 3 || fd >= getdtablesize()) return 65;
        struct checkpoint restored;
        if (pread((int)fd, &restored, sizeof(restored), 0) != sizeof(restored)
            || restored.magic != MAGIC || restored.host != getpid() || restored.state_fd != fd) return 65;
        state = restored;
        /* Rebuild low-level wrappers around the inherited descriptors, not PTYs. */
        for (int i = 0; i < COUNT; i++) {
            struct child *child = &state.children[i];
            if (child->master < 0) continue;
            struct winsize size;
            if (ioctl(child->master, TIOCGWINSZ, &size)) fail("restore PTY");
        }
    }
    inventory();
    char line[8192];
    while (fgets(line, sizeof(line), stdin)) {
        int index, a, b;
        char text[4096];
        if (!strcmp(line, "INFO\n")) inventory();
        else if (!strcmp(line, "STOP\n")) break;
        else if (sscanf(line, "REEXEC %4095s", text) == 1) replace_image(text);
        else if (sscanf(line, "SPAWN %d %d", &index, &a) == 2 && index >= 2 && index < COUNT) { spawn(index, a); inventory(); }
        else if (sscanf(line, "READ %d", &index) == 1 && index >= 0 && index < COUNT) read_pty(index);
        else if (sscanf(line, "WRITE %d %4095s", &index, text) == 2 && index >= 0 && index < COUNT) write_pty(index, text);
        else if (sscanf(line, "SIZE %d %d %d", &index, &a, &b) == 3 && index >= 0 && index < COUNT && a > 0 && b > 0) {
            struct winsize size = {.ws_row = (unsigned short)a, .ws_col = (unsigned short)b};
            if (ioctl(state.children[index].master, TIOCSWINSZ, &size)) fail("resize");
            puts("{\"ok\":true}");
        } else if (sscanf(line, "TERM %d %d", &index, &a) == 2 && index >= 0 && index < COUNT && (a == SIGTERM || a == SIGKILL)) {
            terminate(index, a); puts("{\"ok\":true}");
        } else { errno = EINVAL; fail("command"); }
    }
    cleanup();
    puts("{\"stopped\":true}");
    return 0;
}
