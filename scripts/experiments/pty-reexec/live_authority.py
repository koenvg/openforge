#!/usr/bin/env python3
"""Real Ghostty codec plus a live PTY across executable replacement, macOS only."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import time
import re
import unittest

from run import Host, EVIDENCE, record, macos
from preflight_cases import Preflight

SOURCE = Path(__file__).resolve().parent


class LiveAuthority(unittest.TestCase):
    def test_numbered_output_backpressure_and_pause(self):
        with tempfile.TemporaryDirectory(prefix="openforge-authority-pressure-") as directory:
            root = Path(directory).resolve()
            for name in ("live-authority-a", "live-authority-b"):
                shutil.copy2(OPTIONS.bin_dir / name, root / name)
            subprocess.run(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror", "-DBURST",
                            str(SOURCE / "model_fixture.c"), "-o", str(root / "fixture")], check=True)
            host = Host(root, command=[str(root / "live-authority-a"), "start", str(root / "fixture")])
            try:
                initial = host.receive()
                host.until(0, rb"BURST_READY\r\n")
                identities = {pid: macos.identity(macos.process(pid)) for pid in
                              (host.proc.pid, initial["children"][0]["pid"])}
                host.write(0, "run\n")
                host.until(0, rb"ROW \d+ ")
                before = host.command("INFO")
                descriptors = macos.descriptors(host.proc.pid)
                request_started = time.monotonic_ns()
                if not OPTIONS.pressure_control:
                    self.assertEqual(host.command(f"REEXEC {root / 'live-authority-b'}"), {"prepared": True})
                paused_at = time.monotonic_ns()
                time.sleep(0.2)  # Deliberate quiesced interval; no PTY reads or writes.
                exec_requested = time.monotonic_ns()
                after = before if OPTIONS.pressure_control else host.command("GO")
                ready_at = time.monotonic_ns()
                self.assertEqual(after["version"], 1 if OPTIONS.pressure_control else 2)
                self.assertEqual(macos.descriptors(host.proc.pid), descriptors)
                for pid, identity in identities.items():
                    self.assertEqual(macos.identity(macos.process(pid)), identity)
                deadline = time.monotonic() + 120  # Debug Ghostty integrity checks are intentionally enabled.
                done = re.compile(rb"BURST_DONE (\d+) MAX_WRITE_NS (\d+) TOTAL_NS (\d+)\r\n")
                while not done.search(host.output[0]) and time.monotonic() < deadline:
                    host.read(0)
                match = done.search(host.output[0])
                self.assertIsNotNone(match, "burst did not finish")
                count, max_write_ns, total_ns = map(int, match.groups())
                numbers = list(map(int, re.findall(rb"ROW (\d+) [x]+\r\n", host.output[0])))
                self.assertEqual(count, 4096)
                self.assertEqual(numbers, list(range(4096)), "numbered output lost or duplicated")
                self.assertGreater(max_write_ns, 150_000_000, "deliberate pause did not backpressure the producer")
                host.write(0, "finish\n")
                try:
                    final = host.command("INFO")
                except TimeoutError:
                    profile = subprocess.run(["sample", str(host.proc.pid), "1", "1", "-file",
                                              str(OPTIONS.report.with_suffix(".sample.txt"))],
                                             capture_output=True, text=True, timeout=10)
                    record("profile", status=profile.returncode, stderr=profile.stderr[-2000:])
                    raise
                self.assertEqual(final["writes"], 2)
                self.assertEqual(final["replies"], 0)
                self.assertIn("ROW 4095 ", final["text"])
                text = final.pop("text")
                final["textSha256"] = hashlib.sha256(text.encode()).hexdigest()
                final["textTail"] = text[-240:]
                self.assertLessEqual(final["checkpointBytes"], 64 * 1024 * 1024)
                record("authorityPressure", numberedLines=count, bytes=host.cursors[0],
                       outputSha256=hashlib.sha256(host.output[0]).hexdigest(),
                       maxWriteNs=max_write_ns, producerTotalNs=total_ns,
                       requestToReadyNs=ready_at-request_started,
                       deliberatePauseNs=exec_requested-paused_at, execRequestToReadyNs=ready_at-exec_requested,
                       before=before, after=after, final=final, descriptors=descriptors)
            finally:
                host.close()

    def test_parser_query_primary_screen_and_live_descriptors_survive(self):
        for fail_initialization in (False, True):
            with self.subTest(fail_initialization=fail_initialization):
                with tempfile.TemporaryDirectory(prefix="openforge-live-authority-") as directory:
                    root = Path(directory).resolve()
                    for name in ("live-authority-a", "live-authority-b"):
                        shutil.copy2(OPTIONS.bin_dir / name, root / name)
                    subprocess.run(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                                    str(SOURCE / "model_fixture.c"), "-o", str(root / "fixture")], check=True)
                    command = [str(root / "live-authority-a"), "start", str(root / "fixture")]
                    if OPTIONS.negative_control:
                        command.append("forget-state")
                    host = Host(root, command=command)
                    try:
                        initial = host.receive()
                        host.until(0, rb"ALT\x1b\[31$")
                        before = host.command("INFO")
                        identities = {pid: macos.identity(macos.process(pid)) for pid in
                                      (host.proc.pid, initial["children"][0]["pid"])}
                        descriptors = macos.descriptors(host.proc.pid)
                        self.assertEqual(descriptors, sorted([0, 1, 2, before["stateFd"], before["children"][0]["fd"]]))
                        self.assertEqual(macos.descriptors(initial["children"][0]["pid"]), [0, 1, 2])
                        self.assertEqual(before["architecture"], {"arm64": "aarch64", "x86_64": "x86_64"}[platform.machine()])
                        suffix = " FAIL" if fail_initialization else ""
                        self.assertEqual(host.command(f"REEXEC {root / 'live-authority-b'}{suffix}"),
                                         {"prepared": True})
                        after = host.command("GO")
                        self.assertEqual(after["version"], 1 if fail_initialization else 2)
                        self.assertEqual(after["recoveries"], int(fail_initialization))
                        self.assertEqual(after.get("activation"),
                                         {"status": "failed", "requestedVersion": 2, "stage": "initialization"}
                                         if fail_initialization else {"status": "active", "requestedVersion": 2})
                        expected_image = root / ("live-authority-a" if fail_initialization else "live-authority-b")
                        self.assertEqual(macos.executable(host.proc.pid), str(expected_image))
                        self.assertEqual(macos.descriptors(host.proc.pid), descriptors)
                        self.assertEqual(after["children"], before["children"])
                        self.assertLessEqual(after["checkpointBytes"], 64 * 1024 * 1024)
                        for pid, identity in identities.items():
                            self.assertEqual(macos.identity(macos.process(pid)), identity)
                        if not OPTIONS.negative_control:
                            refusal = host.command(f"REEXEC {root / 'live-authority-a'}")
                            self.assertIn("continuation is temporarily unavailable", refusal.get("refused", ""))
                            self.assertEqual(macos.descriptors(host.proc.pid), descriptors)
                            record("postRestoreCheckpointRefusal", response=refusal)
                        host.write(0, "continue\n")
                        host.until(0, rb"QUERY=[0-9a-f]+\r\n")
                        continued = host.command("INFO")
                        self.assertIn("ALTRED", continued["text"])
                        self.assertIn(b"QUERY=1b5b313b3752\r\n", host.output[0])
                        self.assertEqual(continued["replies"], 1, "query must be answered exactly once")
                        self.assertEqual(continued["writes"], 1, "accepted input must not replay")
                        host.command("SIZE 0 37 101")
                        self.assertEqual(host.command(f"REEXEC {root / 'live-authority-a'}"), {"prepared": True})
                        restored = host.command("GO")
                        self.assertEqual(restored["version"], 1)
                        self.assertEqual(restored["rows"], 37)
                        self.assertEqual(restored["cols"], 101)
                        self.assertEqual(macos.descriptors(host.proc.pid), descriptors)
                        host.write(0, "finish\n")
                        host.until(0, rb"DONE\r\n")
                        final = host.command("INFO")
                        self.assertIn("PRIMARYDONE", final["text"], "inactive primary screen was lost")
                        self.assertEqual(final["writes"], 2)
                        self.assertEqual(final["replies"], 1)
                        record("liveAuthority", failedInitialization=fail_initialization, before=before,
                               after=after, continued=continued, final=final, descriptors=descriptors,
                               identities=identities, observedBytes=host.output[0].hex())
                    finally:
                        host.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--pressure-control", action="store_true", help="omit only the pressure-case replacement")
    parser.add_argument("tests", nargs="*", help="optional unittest names")
    OPTIONS = parser.parse_args()
    Preflight.bin_dir = OPTIONS.bin_dir
    program = unittest.main(argv=[__file__, *OPTIONS.tests], exit=False, verbosity=2)
    paths = [SOURCE / "model_fixture.c", SOURCE / "live_authority.py", SOURCE / "preflight_cases.py", SOURCE / "run.py",
             SOURCE / "image_probe.c",
             SOURCE / "macos.py", SOURCE / "live-authority-proof.mjs",
             SOURCE / "authority/Cargo.toml", SOURCE / "authority/Cargo.lock",
             SOURCE.parents[2] / "scripts/prepare-ghostty-vt.mjs"]
    paths += list((SOURCE / "authority/src").glob("*.rs"))
    paths += list((SOURCE.parents[2] / "src-tauri/src/terminal_model").glob("*.rs"))
    paths.append(SOURCE.parents[2] / "src-tauri/src/terminal_model.rs")
    report = {"platform": platform.platform(), "architecture": platform.machine(),
              "negativeControl": OPTIONS.negative_control, "passed": program.result.wasSuccessful(),
              "pressureControl": OPTIONS.pressure_control, "fullReleaseGatePassed": False,
              "binarySha256": {name: hashlib.sha256((OPTIONS.bin_dir / name).read_bytes()).hexdigest()
                               for name in ("live-authority-a", "live-authority-b")},
              "testsRun": program.result.testsRun, "sources": {
                  str(p.relative_to(SOURCE.parents[2])): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
              "failures": [str(t) + "\n" + trace for t, trace in program.result.failures + program.result.errors],
              "events": EVIDENCE}
    OPTIONS.report.write_text(json.dumps(report, indent=2) + "\n")
    raise SystemExit(0 if report["passed"] else 1)
