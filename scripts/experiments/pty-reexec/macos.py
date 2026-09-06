"""Independent kernel observations, not host-reported process identity."""
import ctypes as c
import os
import subprocess


class BsdInfo(c.Structure):
    _fields_ = [(name, c.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid",
        "rgid", "svuid", "svgid", "reserved",
    )] + [("comm", c.c_char * 16), ("name", c.c_char * 32)] + [
        (name, c.c_uint32) for name in (
            "nfiles", "pgid", "jobc", "tdev", "tpgid", "nice",
        )
    ] + [("sec", c.c_uint64), ("usec", c.c_uint64)]


lib = c.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pidinfo.argtypes = [c.c_int, c.c_int, c.c_uint64, c.c_void_p, c.c_int]
lib.proc_pidinfo.restype = c.c_int
lib.proc_pidpath.argtypes = [c.c_int, c.c_void_p, c.c_uint32]
lib.proc_pidpath.restype = c.c_int


def process(pid):
    info = BsdInfo()
    if lib.proc_pidinfo(pid, 3, 0, c.byref(info), c.sizeof(info)) != c.sizeof(info):
        return None
    return {name: getattr(info, name) for name in (
        "pid", "ppid", "uid", "pgid", "status", "sec", "usec", "tdev",
    )}


def identity(info):
    return info["pid"], info["uid"], info["sec"], info["usec"]


def executable(pid):
    buffer = c.create_string_buffer(4096)
    if lib.proc_pidpath(pid, buffer, len(buffer)) <= 0:
        raise RuntimeError(f"Cannot observe executable of {pid}")
    return os.path.realpath(os.fsdecode(buffer.value))


def descriptors(pid):
    # PROC_PIDLISTFDS returns pairs of int fd and uint type.
    buffer = (c.c_int32 * 8192)()
    size = lib.proc_pidinfo(pid, 1, 0, buffer, c.sizeof(buffer))
    if size <= 0 or size >= c.sizeof(buffer) or size % 8:
        raise RuntimeError(f"Cannot audit descriptors of {pid}: {size}")
    return sorted(buffer[i] for i in range(0, size // 4, 2))

def process_state(pid):
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "stat="],
                            capture_output=True, text=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr)
    return result.stdout.strip() or None



def descendants(root):
    rows = subprocess.check_output(["/bin/ps", "-axo", "pid=,ppid="], text=True)
    parents = {int(pid): int(ppid) for pid, ppid in (row.split() for row in rows.splitlines())}
    owned = {root}
    while True:
        updated = owned | {pid for pid, parent in parents.items() if parent in owned}
        if updated == owned:
            return [info for pid in sorted(owned) if (info := process(pid))]
        owned = updated
