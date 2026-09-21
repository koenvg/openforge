#!/usr/bin/env python3
"""Exercise the whisper CMake policy without downloading or building Rust crates."""

from pathlib import Path
import subprocess
import tempfile
import unittest

HOOK = Path(__file__).resolve().parent.parent / "config/whisper-portable-cpu.cmake"


class WhisperCmakePolicyTests(unittest.TestCase):
    def test_target_policy(self):
        cases = [
            ("Darwin", "arm64", "arm64", "OFF", "armv8-a"),
            ("Darwin", "arm64", "x86_64", "OFF", "armv8-a"),
            ("Darwin", "", "arm64", "OFF", "armv8-a"),
            ("Darwin", "x86_64", "arm64", "ON", ""),
            ("Darwin", "x86_64", "x86_64", "ON", ""),
            ("Linux", "", "aarch64", "ON", ""),
        ]
        for system, architectures, processor, native, arch in cases:
            with self.subTest(system=system, architectures=architectures, processor=processor):
                with tempfile.TemporaryDirectory() as directory:
                    script = Path(directory) / "check.cmake"
                    script.write_text(f'''
set(CMAKE_SYSTEM_NAME "{system}")
set(CMAKE_OSX_ARCHITECTURES "{architectures}")
set(CMAKE_SYSTEM_PROCESSOR "{processor}")
set(GGML_NATIVE ON CACHE BOOL "")
set(GGML_CPU_ARM_ARCH "" CACHE STRING "")
set(GGML_METAL ON CACHE BOOL "")
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "")
include("{HOOK.as_posix()}")
if(NOT GGML_NATIVE STREQUAL "{native}" OR NOT GGML_CPU_ARM_ARCH STREQUAL "{arch}")
    message(FATAL_ERROR "Unexpected CPU policy: ${{GGML_NATIVE}} / ${{GGML_CPU_ARM_ARCH}}")
endif()
if(NOT GGML_METAL OR NOT GGML_METAL_EMBED_LIBRARY)
    message(FATAL_ERROR "Metal support was disabled")
endif()
''')
                    subprocess.run(["cmake", "-P", str(script)], check=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
