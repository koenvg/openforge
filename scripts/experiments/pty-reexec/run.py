#!/usr/bin/env python3
"""Run only this isolated macOS subsystem: python3 scripts/experiments/pty-reexec/run.py."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest

if sys.platform != "darwin":
    raise SystemExit("This proof requires macOS. No other platform counts as evidence.")
import macos

SOURCE = Path(__file__).resolve().parent

EVIDENCE = []
NEGATIVE_CONTROL = False

def record(event, **details):
    EVIDENCE.append({"event": event, **details})

class Host:
    def __init__(self, root):
        self.root = root
        self.owned = {}
        self.cursors = [0] * 5
        self.output = [b""] * 5
        self.buffer = b""
        self.barrier = False
        self.closed = False
        env = {"PATH": "/usr/bin:/bin", "HOME": str(root), "TMPDIR": str(root),
               "PS1": "", "PS2": "", "HISTFILE": "/dev/null", "TERM": "xterm-256color",
               "OPENFORGE_APP_DATA_DIR": str(root / "app-data")}
        self.stderr = open(root / "host.stderr", "wb")
        self.proc = subprocess.Popen([str(root / "v1"), "start", str(root / "fixture")],
                                     cwd=root, env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=self.stderr, bufsize=0,
                                     start_new_session=True)
        self.observe()

    def observe(self):
        if self.proc.poll() is not None:
            return
        current = macos.process(self.proc.pid)
        saved = self.owned.get(self.proc.pid)
        if not current or (saved and macos.identity(current) != macos.identity(saved)):
            return  # Never adopt a new process which reused the host PID.
        for info in macos.descendants(self.proc.pid):
            assert info["uid"] == os.getuid()
            self.owned[info["pid"]] = info

    def receive(self):
        deadline = time.monotonic() + 5
        while b"\n" not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.proc.stdout], [], [], max(0, remaining))[0]:
                raise TimeoutError("host response timed out")
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError((self.root / "host.stderr").read_text())
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        self.observe()
        return json.loads(line)

    def send(self, command):
        self.proc.stdin.write((command + "\n").encode())
        if command.startswith("REEXEC "):
            self.barrier = True
        elif command in ("GO", "ABORT"):
            self.barrier = False

    def command(self, command):
        self.send(command)
        return self.receive()

    def read(self, index):
        result = self.command(f"READ {index}")
        assert result["cursor"] == self.cursors[index], "output cursor discontinuity"
        data = bytes.fromhex(result["hex"])
        self.cursors[index] += len(data)
        self.output[index] += data
        return data

    def until(self, index, pattern):
        deadline = time.monotonic() + 5
        data = b""
        while time.monotonic() < deadline:
            data += self.read(index)
            if re.search(pattern, data):
                return data
        raise AssertionError(f"Missing {pattern!r} in {data[-2000:]!r}")

    def write(self, index, text):
        return self.command(f"WRITE {index} {text.encode().hex()}")

    def replace(self, version=2):
        started = time.monotonic()
        assert self.command(f"REEXEC {self.root / f'v{version}'}") == {"prepared": True}
        result = self.command("GO")
        record("replacement", inventory=result, roundTripMs=(time.monotonic() - started) * 1000,
               executable=macos.executable(self.proc.pid))
        return result

    def sweep_owned(self, errors):
        # This phase never talks to the host protocol. Keep parents alive long
        # enough to reap descendants, then close the host's remaining masters.
        forced = False
        pending = dict(self.owned)
        while pending:
            parents = {info["ppid"] for info in pending.values()}
            leaves = [pid for pid in pending if pid not in parents]
            if not leaves:
                errors.append(RuntimeError("cycle in fixture ownership registry"))
                break
            for pid in leaves:
                saved = pending.pop(pid)
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    try:
                        current = macos.process(pid)
                        if current and macos.identity(current) == macos.identity(saved):
                            forced = True
                            os.kill(pid, sig)
                            time.sleep(0.1)
                    except ProcessLookupError:
                        pass  # Exit between observation and signal is harmless.
                    except OSError as error:
                        errors.append(error)  # Continue cleaning other identities.
        return forced

    def survivors(self):
        remaining = []
        for pid, saved in self.owned.items():
            current = macos.process(pid)
            if current and macos.identity(current) == macos.identity(saved):
                remaining.append(pid)
            elif (macos.process_state(pid) or "").startswith("Z"):
                remaining.append(pid)
        return remaining

    def close(self):
        if self.closed:
            return
        errors = []
        try:
            self.observe()
            if self.proc.poll() is None:
                if self.barrier:
                    self.command("ABORT")
                self.send("STOP")
                self.proc.wait(timeout=8)
        except BaseException as error:
            errors.append(error)
        # Graceful failure or an exited host must never bypass this phase.
        try:
            self.observe()
        except Exception as error:
            errors.append(error)
        forced = self.sweep_owned(errors)
        try:
            self.proc.wait(timeout=5)
        except Exception as error:
            errors.append(error)
        for stream in (self.proc.stdin, self.proc.stdout, self.stderr):
            try:
                stream.close()
            except Exception as error:
                errors.append(error)
        remaining = list(self.owned)
        try:
            deadline = time.monotonic() + 5
            while True:
                remaining = self.survivors()
                if not remaining or time.monotonic() >= deadline:
                    break
                time.sleep(0.02)
            if remaining:
                errors.append(AssertionError(f"Fixture descendants survived: {remaining}"))
            else:
                self.closed = True  # Failed audits remain retryable.
        except Exception as error:
            errors.append(error)
        record("cleanup", owned=list(self.owned.values()), survivors=remaining, forced=forced,
               errors=[str(error) for error in errors])
        if errors:
            if len(errors) > 1:
                raise errors[0] from RuntimeError("; ".join(str(error) for error in errors[1:]))
            raise errors[0]
        assert not forced, "verified fixture processes were forcibly cleaned"
        assert self.proc.returncode == 0, (self.root / "host.stderr").read_text()


class Continuity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="openforge-pty-reexec-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        flags = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2"]
        if NEGATIVE_CONTROL:
            flags.append("-DNO_REEXEC")
        record("test", name=self.id(), runtimeRoot=str(self.root), mode=oct(self.root.stat().st_mode & 0o777))
        for version in (1, 2):
            subprocess.run(["/usr/bin/clang", *flags, f"-DVERSION={version}",
                            str(SOURCE / "host.c"), "-o", str(self.root / f"v{version}")], check=True)
        subprocess.run(["/usr/bin/clang", *flags, str(SOURCE / "fixture.c"),
                        "-o", str(self.root / "fixture")], check=True)
        self.host = Host(self.root)
        self.addCleanup(self.host.close)
        self.initial = self.host.receive()
        self.host.until(1, rb"AGENT \d+ TOOL_PID \d+\r?\n")
        match = re.search(rb"AGENT (\d+) TOOL_PID (\d+)", self.host.output[1])
        self.agent, self.tool = map(int, match.groups())
        self.host.observe()
        self.host.until(1, rb"TOOL \d+ \d+\r\n")
        record("initial", inventory=self.initial, executable=macos.executable(self.host.proc.pid),
               processes=list(self.host.owned.values()))

    def test_live_host_runs_new_executable_without_restarting_children(self):
        host = self.host
        before = {pid: macos.process(pid) for pid in (
            host.proc.pid, self.initial["children"][0]["pid"], self.agent, self.tool,
        )}
        after = host.replace()
        self.assertEqual(after["version"], 2, "live host did not activate v2")
        self.assertEqual(macos.executable(host.proc.pid), str(self.root / "v2"))
        for pid, info in before.items():
            current = macos.process(pid)
            self.assertEqual(macos.identity(current), macos.identity(info))
            for key in ("ppid", "pgid", "tdev"):
                self.assertEqual(current[key], info[key])
        for old, new in zip(self.initial["children"][:2], after["children"][:2]):
            for key in ("pid", "fd", "tty", "device"):
                self.assertEqual(old[key], new[key])
        record("continuity", before=list(before.values()),
               after=[macos.process(pid) for pid in before])

    def test_shell_state_echo_resize_and_running_tool_survive(self):
        host = self.host
        (self.root / "work").mkdir()
        host.write(0, "cd work; export REEXEC_VALUE=still-here\n")
        host.write(0, "printf 'BEFORE:%s:%s\\n' \"$PWD\" \"$REEXEC_VALUE\"\n")
        host.until(0, rb"\r\nBEFORE:.*work:still-here\r\n")
        host.until(1, rb"TOOL \d+ \d+\r\n")
        first_ticks = re.findall(rb"TOOL \d+ (\d+)\r\n", host.output[1])
        host.command("SIZE 0 29 91")
        host.replace()
        host.write(0, "stty size; printf 'GEOMETRY-DONE\\n'\n")
        output = host.until(0, rb"\r\nGEOMETRY-DONE\r\n")
        self.assertIn(b"\r\n29 91\r\n", output, "geometry reset during replacement")
        host.command("SIZE 0 37 101")
        host.write(0, "stty size; /bin/sh -c 'printf \"AFTER:%s:%s\\n\" \"$PWD\" \"$REEXEC_VALUE\"'\n")
        output = host.until(0, rb"\r\nAFTER:.*work:still-here\r\n")
        self.assertIn(b"\r\n37 101\r\n", output)
        self.assertIn(f"AFTER:{self.root}/work:still-here\r\n".encode(), output)
        host.write(1, "ping-after-reexec\n")
        output = host.until(1, rb"AGENT_ECHO ping-after-reexec\r\n")
        self.assertIn(b"ping-after-reexec", output.splitlines(), "terminal line discipline echo missing")
        host.until(1, rb"TOOL \d+ \d+\r\n")
        ticks = list(map(int, re.findall(rb"TOOL \d+ (\d+)\r\n", host.output[1])))
        self.assertGreater(ticks[-1], int(first_ticks[-1]))
        self.assertEqual(ticks, list(range(ticks[-1] + 1)), "lost or duplicated tool output")

    def test_descriptor_allowlist_and_no_child_leaks(self):
        host = self.host
        info = host.command("INFO")
        expected = [0, 1, 2, info["stateFd"], info["sentinel"]] + [c["fd"] for c in info["children"][:2]]
        self.assertEqual(macos.descriptors(host.proc.pid), sorted(expected))
        shell = info["children"][0]["pid"]
        self.assertEqual(macos.descriptors(shell), [0, 1, 2, 255])
        for pid in (self.agent, self.tool):
            self.assertEqual(macos.descriptors(pid), [0, 1, 2])
        after = host.replace()
        expected.remove(info["sentinel"])
        self.assertEqual(after["fds"], sorted(expected))
        self.assertEqual(macos.descriptors(host.proc.pid), sorted(expected))
        self.assertEqual(macos.descriptors(shell), [0, 1, 2, 255])
        record("descriptorAudit", before=info["fds"], after=after["fds"],
               shell=macos.descriptors(shell), agent=macos.descriptors(self.agent), tool=macos.descriptors(self.tool))
        for pid in (self.agent, self.tool):
            self.assertEqual(macos.descriptors(pid), [0, 1, 2])
        host.write(0, f"{self.root}/fixture audit\n")
        host.until(0, rb"\r\nFDS 0 1 2 END\r\n")
        host.command("SPAWN 2 23")
        host.until(2, rb"EXIT_READY\r\n")
        child = host.command("INFO")["children"][2]
        self.assertEqual(macos.descriptors(child["pid"]), [0, 1, 2])

    def release_exit(self, index):
        info = self.host.command("INFO")["children"][index]
        saved = self.host.owned[info["pid"]]
        current = macos.process(info["pid"])
        self.assertEqual(macos.identity(current), macos.identity(saved))
        self.assertEqual(current["ppid"], self.host.proc.pid)
        os.kill(info["pid"], signal.SIGUSR1)

    def wait_reaped(self, index, expected_status):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            self.host.read(index)
            child = self.host.command("INFO")["children"][index]
            if child["reaped"]:
                self.assertEqual(child["status"], expected_status)
                self.assertIsNone(macos.process(child["pid"]), "reaped PID still present")
                self.assertIsNone(macos.process_state(child["pid"]), "zombie remains after reaping")
                record("reaped", slot=index, child=child)
                return child
            time.sleep(0.01)
        self.fail(f"child {index} was not reaped")

    def test_exit_status_before_during_after_and_group_termination(self):
        host = self.host
        for index, code in ((2, 21), (3, 22), (4, 23)):
            host.command(f"SPAWN {index} {code}")
            host.until(index, rb"EXIT_READY\r\n")
        self.release_exit(2)
        before = self.wait_reaped(2, 21 << 8)
        during_pid = host.command("INFO")["children"][3]["pid"]
        self.assertEqual(host.command(f"REEXEC {self.root}/v2"), {"prepared": True})
        # The host is quiesced after checkpoint and cannot reap this exit.
        # Slot PID was captured from the protocol before entering the barrier.
        saved = host.owned[during_pid]
        self.assertEqual(macos.identity(macos.process(during_pid)), macos.identity(saved))
        os.kill(during_pid, signal.SIGUSR1)
        deadline = time.monotonic() + 5
        while not (macos.process_state(during_pid) or "").startswith("Z") and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue((macos.process_state(during_pid) or "").startswith("Z"), "exit must precede v2 startup")
        record("quiescedExit", pid=during_pid, state=macos.process_state(during_pid))
        after = host.command("GO")
        self.assertEqual(after["version"], 2)
        self.assertEqual(after["children"][2], before, "reaped exit journal lost")
        self.wait_reaped(3, 22 << 8)
        self.release_exit(4)
        self.wait_reaped(4, 23 << 8)
        host.command("TERM 1 15")
        host.until(1, rb"TOOL_REAPED 15\r\n")
        self.wait_reaped(1, 143 << 8)
        self.assertIsNone(macos.process(self.tool))
        host.command("TERM 0 9")
        self.wait_reaped(0, 9)

    def test_teardown_at_checkpoint_does_not_activate_target(self):
        self.host.command(f"REEXEC {self.root}/v2")
        self.host.close()
    def test_unresponsive_checkpoint_host_is_cleaned_without_protocol(self):
        host = self.host
        host.command(f"REEXEC {self.root}/v2")
        current = macos.process(host.proc.pid)
        self.assertEqual(macos.identity(current), macos.identity(host.owned[host.proc.pid]))
        record("faultInjection", fault="SIGSTOP host at checkpoint; ABORT must time out")
        os.kill(host.proc.pid, signal.SIGSTOP)
        with self.assertRaisesRegex(TimeoutError, "host response timed out"):
            host.close()
        self.assertTrue(host.closed, "fault cleanup did not complete its survivor audit")



    def test_repeated_replacement_and_failed_exec_keep_sessions_usable(self):
        host = self.host
        for version in (2, 1, 2):
            self.assertEqual(host.replace(version)["version"], version)
            self.assertEqual(macos.executable(host.proc.pid), str(self.root / f"v{version}"))
            host.write(1, f"version-{version}\n")
            host.until(1, f"AGENT_ECHO version-{version}\\r\\n".encode())
        host.command(f"REEXEC {self.root}/does-not-exist")
        self.assertIn("execError", host.command("GO"))
        self.assertEqual(host.command("INFO")["version"], 2)
        host.write(1, "failed-exec-still-live\n")
        host.until(1, rb"AGENT_ECHO failed-exec-still-live\r\n")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write platform evidence JSON outside the temporary runtime")
    parser.add_argument("--negative-control", action="store_true", help="Build a host that stays on v1; continuity must FAIL")
    options, tests = parser.parse_known_args()
    NEGATIVE_CONTROL = options.negative_control
    if NEGATIVE_CONTROL and not tests:
        tests = ["Continuity.test_live_host_runs_new_executable_without_restarting_children"]
    print(f"Platform: {platform.platform()}; Python {platform.python_version()}", flush=True)
    program = unittest.main(argv=[sys.argv[0], *tests], verbosity=2, exit=False)
    if options.report:
        report = {
            "platform": platform.platform(), "architecture": platform.machine(),
            "python": platform.python_version(),
            "clang": subprocess.check_output(["/usr/bin/clang", "--version"], text=True).strip(),
            "sources": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in SOURCE.iterdir() if p.suffix in (".c", ".py")},
            "negativeControl": NEGATIVE_CONTROL, "testsRun": program.result.testsRun,
            "passed": program.result.wasSuccessful(),
            "failures": [str(test) + "\n" + trace for test, trace in program.result.failures + program.result.errors],
            "events": EVIDENCE,
        }
        options.report.write_text(json.dumps(report, indent=2) + "\n")
    raise SystemExit(0 if program.result.wasSuccessful() else 1)
