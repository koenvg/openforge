"""Replacement refusal through the isolated authority owner's control protocol."""
import os
from concurrent.futures import ThreadPoolExecutor
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from run import Host, macos, record

SOURCE = Path(__file__).resolve().parent


class Preflight(unittest.TestCase):
    bin_dir = None

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="openforge-authority-preflight-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        for name in ("live-authority-a", "live-authority-b"):
            shutil.copy2(self.bin_dir / name, self.root / name)
        subprocess.run(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                        str(SOURCE / "model_fixture.c"), "-o", str(self.root / "fixture")], check=True)
        self.host = Host(self.root, command=[str(self.root / "live-authority-a"),
                                            "start", str(self.root / "fixture")])
        self.addCleanup(self.host.close)
        initial = self.host.receive()
        self.host.until(0, rb"ALT\x1b\[31$")
        self.identities = {pid: macos.identity(macos.process(pid)) for pid in
                           (self.host.proc.pid, initial["children"][0]["pid"])}
        self.descriptors = macos.descriptors(self.host.proc.pid)

    def test_refuses_a_fifo_without_waiting_for_another_process_to_open_it(self):
        fifo = self.root / "not-an-image"
        os.mkfifo(fifo, 0o600)

        def release_blocked_open():
            time.sleep(2)  # Lets the pre-fix host return so negative-control cleanup stays graceful.
            fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
            os.close(fd)

        before = self.host.command("INFO")
        with ThreadPoolExecutor(max_workers=1) as executor:
            release = executor.submit(release_blocked_open)
            started = time.monotonic_ns()
            response = self.host.command(f"REEXEC {fifo}")
            elapsed = time.monotonic_ns() - started
            release.result(timeout=5)
        record("authoritySpecialFileRefusal", response=response, elapsedNs=elapsed)
        self.assertIn("refused", response)
        self.assertLess(elapsed, 1_000_000_000, "preflight waited for an unrelated FIFO peer")
        self.assertEqual(self.host.command("INFO"), before)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")

    def test_changed_target_version_falls_back_before_consuming_pty_state(self):
        candidate = self.root / "candidate"
        shutil.copy2(self.bin_dir / "live-authority-b", candidate)
        before = self.host.command("INFO")
        self.assertEqual(self.host.command(f"REEXEC {candidate}"), {"prepared": True})
        shutil.copy2(self.bin_dir / "live-authority-a", candidate)
        restored = self.host.command("GO")
        record("authorityChangedImage", response=restored)
        self.assertEqual(restored.get("activation"), {
            "status": "failed", "requestedVersion": 2, "stage": "version",
        })
        self.assertEqual(restored["version"], 1)
        self.assertEqual(restored["children"], before["children"])
        self.assertEqual(restored["recoveries"], 1)
        self.assertEqual(macos.executable(self.host.proc.pid), str(self.root / "live-authority-a"))
        self.assertEqual(macos.descriptors(self.host.proc.pid), self.descriptors)
        for pid, identity in self.identities.items():
            self.assertEqual(macos.identity(macos.process(pid)), identity)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")
        self.assertEqual(self.host.command(f"REEXEC {self.root / 'live-authority-b'}"), {"prepared": True})
        activated = self.host.command("GO")
        self.assertEqual(activated["version"], 2)
        self.assertEqual(activated["activation"], {"status": "active", "requestedVersion": 2})
        self.host.write(0, "finish\n")
        self.host.until(0, rb"DONE\r\n")
        final = self.host.command("INFO")
        self.assertEqual(final["writes"], 2)
        self.assertEqual(final["replies"], 1)
        self.assertIn("PRIMARYDONE", final["text"])

    def test_refuses_a_script_even_when_it_claims_a_compatible_contract(self):
        script = self.root / "pretend-image"
        script.write_text(
            "#!/bin/sh\n"
            "touch script-ran\n"
            "printf '%s\\n' '{\"protocol\":1,\"stateFormat\":2,\"authorityCodec\":\"ghostty-de9fd9b0-v1\",\"architecture\":\"aarch64\",\"imageVersion\":2}'\n"
        )
        script.chmod(0o700)
        before = self.host.command("INFO")
        response = self.host.command(f"REEXEC {script}")
        record("authorityNonImageRefusal", response=response)
        self.assertIn("refused", response)
        self.assertFalse((self.root / "script-ran").exists(), "non-image target was executed")
        self.assertEqual(self.host.command("INFO"), before)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")

    def test_refuses_replacement_when_the_retained_recovery_image_cannot_start(self):
        recovery = self.root / "live-authority-a"
        before = self.host.command("INFO")
        recovery.chmod(0o600)
        try:
            response = self.host.command(f"REEXEC {self.root / 'live-authority-b'} FAIL")
            record("authorityRecoveryImageRefusal", response=response)
            self.assertIn("refused", response)
            self.assertEqual(self.host.command("INFO"), before)
            self.assertEqual(macos.descriptors(self.host.proc.pid), self.descriptors)
        finally:
            recovery.chmod(0o700)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")
        self.assertEqual(self.host.command(f"REEXEC {self.root / 'live-authority-b'} FAIL"), {"prepared": True})
        restored = self.host.command("GO")
        self.assertEqual(restored["version"], 1)
        self.assertEqual(restored["activation"], {
            "status": "failed", "requestedVersion": 2, "stage": "initialization",
        })
        self.assertEqual(macos.executable(self.host.proc.pid), str(recovery))
        for pid, identity in self.identities.items():
            self.assertEqual(macos.identity(macos.process(pid)), identity)
        self.host.write(0, "finish\n")
        self.host.until(0, rb"DONE\r\n")
        final = self.host.command("INFO")
        self.assertEqual(final["writes"], 2)
        self.assertEqual(final["replies"], 1)
        self.assertIn("PRIMARYDONE", final["text"])

    def test_failed_exec_reports_unsuccessful_activation_and_keeps_the_old_owner_live(self):
        target = self.root / "live-authority-b"
        before = self.host.command("INFO")
        self.assertEqual(self.host.command(f"REEXEC {target}"), {"prepared": True})
        target.unlink()  # Actual exec failure after a successful, isolated preflight.
        failed = self.host.command("GO")
        record("authorityFailedExec", response=failed)
        self.assertIn("execError", failed)
        self.assertEqual(failed.get("activation"), {
            "status": "failed", "requestedVersion": 2, "stage": "exec",
        })
        after = self.host.command("INFO")
        self.assertEqual(after["activation"], failed["activation"])
        self.assertEqual(after["children"], before["children"])
        self.assertEqual(after["version"], 1)
        self.assertEqual(macos.executable(self.host.proc.pid), str(self.root / "live-authority-a"))
        self.assertEqual(macos.descriptors(self.host.proc.pid), self.descriptors)
        for pid, identity in self.identities.items():
            self.assertEqual(macos.identity(macos.process(pid)), identity)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")
        shutil.copy2(self.bin_dir / "live-authority-b", target)
        self.assertEqual(self.host.command(f"REEXEC {target}"), {"prepared": True})
        activated = self.host.command("GO")
        self.assertEqual(activated["version"], 2)
        self.assertEqual(activated["activation"], {"status": "active", "requestedVersion": 2})
        self.assertEqual(macos.executable(self.host.proc.pid), str(target))
        self.host.write(0, "finish\n")
        self.host.until(0, rb"DONE\r\n")
        final = self.host.command("INFO")
        self.assertEqual(final["writes"], 2)
        self.assertEqual(final["replies"], 1)
        self.assertIn("PRIMARYDONE", final["text"])

    def test_refuses_incompatible_or_unresponsive_images_without_lending_descriptors(self):
        probe = self.root / "probe"
        subprocess.run(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror",
                        str(SOURCE / "image_probe.c"), "-o", str(probe)], check=True)
        names = ("wrong-protocol", "wrong-state", "wrong-codec", "wrong-architecture",
                 "wrong-version", "empty-response", "oversized-response", "unresponsive")
        for name in names:
            shutil.copy2(probe, self.root / name)
        (self.root / "executable-text").write_text("not an executable image\n")
        (self.root / "executable-text").chmod(0o700)
        (self.root / "truncated-image").write_bytes(b"\xcf\xfa\xed\xfe\x00")
        (self.root / "truncated-image").chmod(0o700)
        shutil.copy2(probe, self.root / "not-executable")
        (self.root / "not-executable").chmod(0o600)
        (self.root / "directory").mkdir()
        before = self.host.command("INFO")
        for name in (*names, "executable-text", "truncated-image", "not-executable", "directory"):
            with self.subTest(target=name):
                started = time.monotonic_ns()
                response = self.host.command(f"REEXEC {self.root / name}")
                elapsed = time.monotonic_ns() - started
                # Restore the barrier for a failing negative control so later cases still run.
                if "prepared" in response:
                    self.host.command("ABORT")
                record("authorityPreflightRefusal", target=name, response=response, elapsedNs=elapsed)
                self.assertIn("refused", response, "unsupported target reached the exec barrier")
                self.assertLess(elapsed, 4_000_000_000)
                self.assertEqual(self.host.command("INFO"), before)
                self.assertEqual(macos.descriptors(self.host.proc.pid), self.descriptors)
                for pid, identity in self.identities.items():
                    self.assertEqual(macos.identity(macos.process(pid)), identity)
        self.assertTrue((self.root / "probe-audit").exists(), "no isolated probe executed")
        audit = [tuple(map(int, line.split())) for line in (self.root / "probe-audit").read_text().splitlines()]
        self.assertEqual(len(audit), len(names), "every executable probe must run in isolation")
        for pid, descriptors, has_secret in audit:
            self.assertEqual(descriptors, 0, "probe inherited a session or checkpoint descriptor")
            self.assertEqual(has_secret, 0, "probe inherited the host environment")
            self.assertIsNone(macos.process_state(pid), "probe child was not reaped")
        record("authorityProbeIsolation", audit=audit)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")
        self.assertEqual(self.host.command(f"REEXEC {self.root / 'live-authority-b'}"), {"prepared": True})
        self.assertEqual(self.host.command("GO")["version"], 2)
        self.host.write(0, "finish\n")
        self.host.until(0, rb"DONE\r\n")
        final = self.host.command("INFO")
        self.assertEqual(final["writes"], 2)
        self.assertEqual(final["replies"], 1)
        self.assertIn("PRIMARYDONE", final["text"])

    def test_refuses_missing_target_without_changing_live_state(self):
        before = self.host.command("INFO")
        started = time.monotonic_ns()
        response = self.host.command(f"REEXEC {self.root / 'missing-image'}")
        elapsed = time.monotonic_ns() - started
        record("authorityPreflightRefusal", target="missing-image", response=response, elapsedNs=elapsed)
        self.assertIn("refused", response, "unsupported target reached the exec barrier")
        self.assertLess(elapsed, 4_000_000_000)
        self.assertEqual(self.host.command("INFO"), before)
        self.assertEqual(macos.descriptors(self.host.proc.pid), self.descriptors)
        for pid, identity in self.identities.items():
            self.assertEqual(macos.identity(macos.process(pid)), identity)
        self.host.write(0, "continue\n")
        self.host.until(0, rb"QUERY=1b5b313b3752\r\n")
        continued = self.host.command("INFO")
        self.assertEqual(continued["writes"], 1)
        self.assertEqual(continued["replies"], 1)
        self.assertIn("ALTRED", continued["text"])
        self.assertEqual(self.host.command(f"REEXEC {self.root / 'live-authority-b'}"), {"prepared": True})
        self.assertEqual(self.host.command("GO")["version"], 2)
        self.host.write(0, "finish\n")
        self.host.until(0, rb"DONE\r\n")
        self.assertIn("PRIMARYDONE", self.host.command("INFO")["text"])
