"""Teardown fault injection at the process/control boundaries. No real signals."""
import unittest
from unittest.mock import Mock, patch

import run


class CleanupFailures(unittest.TestCase):
    def setUp(self):
        self.host = run.Host.__new__(run.Host)
        self.host.closed = False
        self.host.barrier = False
        self.host.owned = {
            pid: {"pid": pid, "ppid": parent, "uid": 501, "sec": 100, "usec": pid}
            for pid, parent in ((10001, 1), (10002, 10001), (10003, 10002))
        }
        self.live = dict(self.host.owned)
        self.host.proc = Mock(pid=10001, returncode=0)
        self.host.proc.poll.side_effect = lambda: None if 10001 in self.live else 0
        self.host.observe = Mock()
        self.host.command = Mock()
        self.host.send = Mock()
        self.host.stderr = Mock()
        self.signals = []
        for target, effect in (
            ("run.macos.process", lambda pid: self.live.get(pid)),
            ("run.macos.process_state", lambda pid: "S" if pid in self.live else None),
            ("run.os.kill", self.signal),
            ("run.time.sleep", lambda _: None),
            ("run.record", lambda *args, **kwargs: None),
        ):
            patcher = patch(target, side_effect=effect)
            patcher.start()
            self.addCleanup(patcher.stop)

    def signal(self, pid, sig):
        self.signals.append(pid)
        self.live.pop(pid, None)

    def assert_cleaned(self):
        self.assertEqual(self.live, {}, "protocol failure bypassed owned-process cleanup")
        self.assertTrue(self.host.closed)
        self.host.proc.stdin.close.assert_called_once()
        self.host.proc.stdout.close.assert_called_once()
        self.host.stderr.close.assert_called_once()

    def test_abort_timeout_still_cleans_all_owned_processes(self):
        self.host.barrier = True
        self.host.command.side_effect = TimeoutError("ABORT timed out")
        with self.assertRaisesRegex(TimeoutError, "ABORT timed out"):
            self.host.close()
        self.assert_cleaned()
        self.assertEqual(self.signals, [10003, 10002, 10001])

    def test_broken_control_pipe_still_cleans_all_owned_processes(self):
        self.host.send.side_effect = BrokenPipeError("STOP pipe broke")
        with self.assertRaisesRegex(BrokenPipeError, "STOP pipe broke"):
            self.host.close()
        self.assert_cleaned()

    def test_exited_host_does_not_hide_surviving_registered_children(self):
        del self.live[10001]
        with self.assertRaisesRegex(AssertionError, "forcibly cleaned"):
            self.host.close()
        self.assert_cleaned()
        self.assertEqual(self.signals, [10003, 10002])

    def test_disappearing_process_does_not_abort_sweep(self):
        self.host.send.side_effect = BrokenPipeError("STOP pipe broke")

        def disappear(pid, sig):
            self.signal(pid, sig)
            if pid == 10003:
                raise ProcessLookupError("exited between identity check and signal")

        with patch("run.os.kill", side_effect=disappear):
            with self.assertRaisesRegex(BrokenPipeError, "STOP pipe broke"):
                self.host.close()
        self.assert_cleaned()

    def test_reused_host_pid_is_not_adopted_during_cleanup_observation(self):
        foreign = {**self.live[10001], "sec": 101}
        self.live[10001] = foreign
        self.host.observe = run.Host.observe.__get__(self.host, run.Host)
        self.host.send.side_effect = BrokenPipeError("STOP pipe broke")
        with patch("run.macos.descendants", return_value=[foreign]):
            with self.assertRaises(BrokenPipeError):
                self.host.close()
        self.assertEqual(self.live, {10001: foreign})
        self.assertNotIn(10001, self.signals)


    def test_reused_pid_is_never_signaled(self):
        foreign = {**self.live[10003], "sec": 101}
        self.live[10003] = foreign
        self.host.send.side_effect = BrokenPipeError("STOP pipe broke")
        with self.assertRaises(BrokenPipeError):
            self.host.close()
        self.assertEqual(self.signals, [10002, 10001])
        self.assertEqual(self.live, {10003: foreign})
        self.assertTrue(self.host.closed)

    def test_failed_survivor_audit_can_be_retried(self):
        self.host.send.side_effect = BrokenPipeError("STOP pipe broke")
        with patch.object(self.host, "survivors", return_value=[10003]), patch("run.time.monotonic", side_effect=[0, 10]):
            with self.assertRaises(BrokenPipeError):
                self.host.close()
        self.assertFalse(self.host.closed)
        self.host.close()
        self.assertTrue(self.host.closed)



if __name__ == "__main__":
    unittest.main(verbosity=2)
